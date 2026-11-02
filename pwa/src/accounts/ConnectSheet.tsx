// THE ADD ACCOUNT DOOR AND THE CONNECT SHEET (accounts plan Task A18, D-5522, D-5513, D-7740; spec §5, §6.1, §6.3, §12.3,
// §12.4, §12.5): Anthropic Paste end to end.
//
// The sheet's frames, in order: Provider → Name it → Method (with Confirm it's you, only when the step-up has lapsed) →
// Run → Result. The frames draw; this file holds the flow, and `connectFlow.ts` decides (the providers and methods each
// narrowed by its cap word, the default method, the default hue, the id and label rules).
//
// THE SECRET (spec §3.3). The pasted token lives only in `SecretField`'s own DOM node. It is read once, on submit,
// which empties the field; it goes out in the one `POST /api/accounts` and is held nowhere else: not in this file's
// state, a store, `localStorage`, `sessionStorage` or IndexedDB. A refusal re-presents the field empty. While the screen
// is offline, no secret field is drawn at all.
//
// NOTHING IS RETRIED ON ITS OWN. A refused add says why, from its code. An add whose answer never came ("outcome
// unknown") re-reads the roster and resumes at the step the reconciled roster shows (the lane exists: Check), or says
// nothing was added; it never sends the add again, so it can never run into `duplicate-id`.
//
// ANNOUNCEMENTS (spec §12.4). One live region per sheet: a step change is announced politely (`role="status"`), and a
// terminal state (refused, outcome unknown, done) as an alert (`role="alert"`). A frame that only re-renders announces
// nothing: an announcement is written by a transition, never by a render.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, ListRow, Sheet } from '@ccrc/ui';
import type { AccountAddAnswer, AccountsConnect, LaneWire, RosterWire } from '../../../shared/api';
import type { ConnectMethod } from '../../../shared/providers';
import type { Hue } from '../../../shared/roster';
import { ApiError, api } from '../lib/api';
import {
  ADD_LANE, ADD_REFUSED, DOOR_META, FRAME_SAID, PICK_ANOTHER_NAME, STEP_UP_AGAIN, PROVIDER_ROWS, DOOR_WORD, LEDGER, NEEDS_APP_UPDATE, OUTCOME_UNKNOWN, TOKEN_CLEARED, TOKEN_FIELD_LABEL,
  addRefusal, configDirFoundText, laneActRefusal, notFoundAfterUnknown, resultDone,
} from '../fleet/accountWords';
import { ConfirmItsYou } from './ConfirmItsYou';
import { CopyCommand } from '../fleet/TroubleCard';
import { FrameFoot, type FootAct } from './FrameFoot';
import { MethodFrame } from './MethodFrame';
import { NameFrame, type ConfigDirFound } from './NameFrame';
import { ProviderFrame } from './ProviderFrame';
import { ResultFrame } from './ResultFrame';
import { RunFrame, type LedgerLine } from './RunFrame';
import { SecretField, type SecretFieldHandle } from './SecretField';
import { useStepUp, type StepUp, type StepUpDeps } from './useStepUp';
import {
  defaultHue, methodChoices, providerChoices, secretShapeOk, sheetRuns, type DoorProvider,
} from './connectFlow';
import type { ProviderRow } from '../../../shared/providers';
import '../fleet/fleet.css';

type Frame = 'provider' | 'name' | 'method' | 'run' | 'result';
type Announcement = { readonly kind: 'status' | 'alert'; readonly text: string };

/** The routes the sheet calls, injectable so a test drives a fake box. */
export type ConnectClient = Pick<typeof api, 'accountAdd' | 'accountCheck' | 'accountEnable'>;

export interface ConnectSheetProps {
  open: boolean;
  onClose: () => void;
  roster: readonly RosterWire[];
  connect: AccountsConnect | null;
  /** The offline refusal (`offlineRefusal`), or `null` while the store reads the server. */
  offline: string | null;
  /** Re-reads `/api/accounts` through the store, its one reader. */
  refresh: () => Promise<void>;
  /** The roster as the store holds it NOW (read after `refresh` resolves, so an outcome unknown sees the re-read). */
  readRoster: () => readonly RosterWire[];
  client?: ConnectClient;
  stepUpDeps?: StepUpDeps;
  /** The provider table the method radio reads its order from; the real one by default. */
  table?: Readonly<Record<DoorProvider, Pick<ProviderRow, 'connect'>>>;
}

/** The `error` word an `ApiError` carries, or `undefined` for a request that never completed. */
function wordOf(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const b = err.body;
  const v = typeof b === 'object' && b !== null ? (b as Record<string, unknown>)['error'] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/** The step-up for the frame that shows it. Mounted only while that frame is drawn and the screen is online, so the
 *  challenge is fetched when the step is SHOWN (`useStepUp`'s rule) and an offline sheet sends nothing. */
function StepUpGate({ freshUntil, deps, children }: {
  freshUntil: number | null; deps: StepUpDeps | undefined; children: (s: StepUp) => ReactNode;
}): ReactNode {
  const s = useStepUp(freshUntil, deps);
  return children(s);
}
const NO_DEPS: StepUpDeps = {};

export function ConnectSheet(props: ConnectSheetProps): ReactNode {
  const { open, onClose, roster, connect, offline, refresh, readRoster } = props;
  const client = props.client ?? api;
  const blocked = offline !== null;

  const [frame, setFrame] = useState<Frame>('provider');
  const [provider, setProvider] = useState<DoorProvider | null>(null);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [hue, setHue] = useState<Hue>(() => defaultHue(roster));
  const [found, setFound] = useState<ConfigDirFound | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [picked, setPicked] = useState<ConnectMethod | null>(null);
  const [hasSecret, setHasSecret] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [lane, setLane] = useState<LaneWire | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Announcement | null>(null);
  const secret = useRef<SecretFieldHandle>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const noticeId = useId();

  // Closed: the field is emptied (it unmounts with the sheet's body, and this says so even if a transition keeps it).
  useEffect(() => { if (!open) secret.current?.clear(); }, [open]);
  // Offline: the field is not drawn, so it unmounts; its value goes with its node.

  const status = (text: string): void => setSaid({ kind: 'status', text });
  const alert = (text: string): void => setSaid({ kind: 'alert', text });
  const write = (text: string): void => setLedger((l) => [...l, { text, at: Date.now() }]);
  /** The last line was a step's running form: replace it with its result. */
  const settle = (text: string): void => setLedger((l) => [...l.slice(0, -1), { text, at: Date.now() }]);

  const choices = provider === null ? null : methodChoices(provider, connect, props.table);
  const method = picked !== null && choices?.choices.some((c) => c.value === picked && c.narrowed === null)
    ? picked : choices?.selected ?? null;

  const check = async (): Promise<void> => {
    write(LEDGER.checking(id));
    status(LEDGER.checking(id));
    const t0 = Date.now();
    let refused: string | null = null;
    try {
      const a = await client.accountCheck(id);
      if (!live.current) return;
      const ms = Date.now() - t0;
      setLatency(ms);
      setLane(a.lane);
      settle(LEDGER.checked);
      setNotice(null);
    } catch (e) {
      if (!live.current) return;
      // A refused (or unanswered) check leaves no lane read: an earlier answer is not this one's, so the result frame
      // holds Turn it on with this sentence beneath it and offers Check again (D-7740 (4)).
      refused = laneActRefusal('check', id, e);
      setLane(null);
      setLatency(null);
      settle(refused);
      setNotice(refused);
    }
    await refresh();
    if (!live.current) return;
    setFrame('result');
    // The terminal state is announced as what it is: the refusal, or the lane added and off.
    alert(refused ?? resultDone(id, false));
  };

  /** The add's answer never came: re-read, and resume where the reconciled roster says. Never a second add. */
  const reconcile = async (): Promise<void> => {
    write(OUTCOME_UNKNOWN);
    alert(OUTCOME_UNKNOWN);
    await refresh();
    if (!live.current) return;
    // The unknown line stays in the ledger: what the re-read found is written after it.
    if (readRoster().some((r) => r.id === id)) {
      write(LEDGER.found(id));
      await check();
      return;
    }
    const text = notFoundAfterUnknown(id);
    setNotice(text);
    setFrame('method');
    alert(text);
  };

  const submit = async (stepUp: StepUp): Promise<void> => {
    if (blocked || busy || provider === null || method === null) return;
    // Read once: the field is empty from here on, whatever the answer.
    const value = secret.current?.take() ?? '';
    if (value === '') { setNotice(TOKEN_CLEARED); alert(TOKEN_CLEARED); return; }
    if (!secretShapeOk(value)) {
      const r = addRefusal(id, 'key-charset')!;
      setNotice(r.text);
      alert(r.text);
      return;
    }
    setBusy(true);
    setNotice(null);
    setFrame('run');
    setLedger([{ text: LEDGER.adding(id), at: Date.now() }]);
    status(LEDGER.adding(id));
    const got: { answer: AccountAddAnswer | null } = { answer: null };
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await stepUp.runAct(async () => {
        got.answer = await client.accountAdd({
          provider, id, label, hue, method, credential: value, ...(adopt ? { adopt: true as const } : {}),
        });
      });
    } catch (e) {
      failure = e;
    }
    if (!live.current) return;
    try {
      if (outcome === 'step-up') {
        setNotice(STEP_UP_AGAIN);
        setFrame('method');
        alert(STEP_UP_AGAIN);
        return;
      }
      if (got.answer !== null) {
        settle(LEDGER.added(id));
        await check();
        return;
      }
      const word = wordOf(failure);
      if (word === undefined || word === 'outcome-unknown') { await reconcile(); return; }
      if (word === 'config-dir-exists') {
        const body = (failure as ApiError).body as Record<string, unknown>;
        const f: ConfigDirFound = typeof body['signedIn'] === 'boolean' ? { signedIn: body['signedIn'] } : {};
        setFound(f);
        setFrame('name');
        alert(configDirFoundText(id, f.signedIn));
        void refresh();
        return;
      }
      if (word === 'lane-exists') {
        // The server's roster holds the id though this screen's did not: re-read, and the name frame says it is taken.
        await refresh();
        if (!live.current) return;
        const r = addRefusal(id, 'duplicate-id')!;
        setNotice(r.text);
        setFrame('name');
        alert(r.text);
        return;
      }
      const r = addRefusal(id, word) ?? { frame: 'method' as const, text: ADD_REFUSED };
      setNotice(r.text);
      setFrame(r.frame);
      alert(r.text);
      void refresh();
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const turnOn = async (): Promise<void> => {
    if (blocked || busy) return;
    setBusy(true);
    write(LEDGER.enabling(id));
    status(LEDGER.enabling(id));
    try {
      const a = await client.accountEnable(id);
      if (!live.current) return;
      setLane(a.lane);
      const nowOn = a.lane.state.word !== 'off';
      setOn(nowOn);
      settle(nowOn ? LEDGER.on : resultDone(id, false));
      setNotice(null);
      alert(resultDone(id, nowOn));
    } catch (e) {
      if (!live.current) return;
      const text = laneActRefusal('switch', id, e);
      settle(text);
      setNotice(text);
      alert(text);
    }
    await refresh();
    if (live.current) setBusy(false);
  };

  const checkAgain = async (): Promise<void> => {
    if (blocked || busy) return;
    setBusy(true);
    await check();
    if (live.current) setBusy(false);
  };

  const freshUntil = connect?.stepUpFreshUntil ?? null;
  const runs = provider !== null && method !== null && sheetRuns(provider, method);

  const back: FootAct = { label: 'Back', onClick: () => { setFrame('name'); setNotice(null); status(FRAME_SAID.name); } };
  let body: ReactNode;
  switch (frame) {
    case 'provider':
      body = (
        <ProviderFrame
          choices={providerChoices(connect)}
          blocked={blocked}
          onPick={(p) => { setProvider(p); setPicked(null); setFrame('name'); status(FRAME_SAID.name); }}
        />
      );
      break;
    case 'name':
      body = (
        <NameFrame
          id={id} label={label} hue={hue} roster={roster} found={found} notice={notice} blocked={blocked}
          onId={(v) => { setId(v); setFound(null); setAdopt(false); setNotice(null); }}
          onLabel={setLabel}
          onHue={setHue}
          onBack={() => { setFrame('provider'); setNotice(null); status(FRAME_SAID.provider); }}
          onContinue={() => { setNotice(null); setFrame('method'); status(FRAME_SAID.method); }}
          onPickAnother={() => { setFound(null); setAdopt(false); setId(''); status(PICK_ANOTHER_NAME); }}
          onUseThere={() => { setFound(null); setAdopt(true); setFrame('method'); status(FRAME_SAID.adopt); }}
        />
      );
      break;
    case 'method':
      body = choices === null ? null : (
        <MethodFrame choices={choices.choices} selected={method} onSelect={(m) => { setPicked(m); setNotice(null); }}>
          {method !== null && !runs && <p className="acct-notice">{NEEDS_APP_UPDATE}</p>}
          {method === 'paste' && runs && !blocked && (
            <SecretField label={TOKEN_FIELD_LABEL} handle={secret} onPresence={setHasSecret} describedBy={notice !== null ? noticeId : undefined} />
          )}
          {notice !== null && <p className="acct-notice" id={noticeId}>{notice}</p>}
          {!blocked && runs ? (
            <StepUpGate freshUntil={freshUntil} deps={props.stepUpDeps ?? NO_DEPS}>
              {(stepUp) => (
                <>
                  <ConfirmItsYou stepUp={stepUp} subject="the fleet's accounts" />
                  <FrameFoot
                    quiet={[back]}
                    primary={{ label: ADD_LANE, onClick: () => { void submit(stepUp); }, disabled: busy || stepUp.needed || !hasSecret, busy }}
                  />
                </>
              )}
            </StepUpGate>
          ) : (
            <FrameFoot quiet={[back]} primary={{ label: ADD_LANE, onClick: () => {}, disabled: true }} />
          )}
        </MethodFrame>
      );
      break;
    case 'run':
      body = <RunFrame lines={ledger} live={busy} />;
      break;
    case 'result':
      body = (
        <>
          <RunFrame lines={ledger} live={busy} />
          <ResultFrame
            id={id} lane={lane} latencyMs={latency} on={on} busy={busy} notice={notice} blocked={blocked}
            nowSec={Math.floor(Date.now() / 1000)}
            onTurnOn={() => { void turnOn(); }}
            onCheckAgain={() => { void checkAgain(); }}
            onClose={onClose}
          />
        </>
      );
      break;
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add account" eyebrow={provider === null ? undefined : PROVIDER_ROWS[provider].name} size="md">
      <div className="acct-connect" data-frame={frame}>
        {/* One live region per sheet (spec §12.4): a step change is polite, a terminal state an alert. */}
        <div className="sr-only">
          <p role="status" data-testid="connect-status">{said?.kind === 'status' ? said.text : ''}</p>
          <p role="alert" data-testid="connect-alert">{said?.kind === 'alert' ? said.text : ''}</p>
        </div>
        {offline !== null && <p className="acct-offline">{offline}</p>}
        {body}
      </div>
    </Sheet>
  );
}

/** The door's reason, beneath it, and the command that fixes it when there is one. */
export function DoorReason({ id, text, fix }: { id: string; text: string; fix?: string }): ReactNode {
  return (
    <div className="acct-door-reason">
      <p className="m-0" id={id}>{text}</p>
      {fix !== undefined && <CopyCommand command={fix} />}
    </div>
  );
}

/**
 * THE ADD ACCOUNT DOOR (D-5522; spec §5): one per width. On a phone (both skins) it is the lane list's last row, a
 * `ListRow` whose height is the skin's row (52px in Refined, 44px in Instrument) with the meta line beside the word; on
 * desktop it is a secondary button in the page's header. It NARROWS IN PLACE, never vanishes: `aria-disabled`, still
 * focusable, its reason named by `aria-describedby` and drawn beneath it. No palette command and no hint key.
 */
export function AddAccountDoor({ desk, narrowedBy, onOpen }: {
  desk: boolean;
  /** The reason's element id when the door is narrowed, or `null` when it opens. */
  narrowedBy: string | null;
  onOpen: () => void;
}): ReactNode {
  const narrowed = narrowedBy !== null;
  const tap = (): void => { if (!narrowed) onOpen(); };
  if (desk) {
    return (
      <Button
        variant="ghost" size="fit" className="acct-door-action"
        aria-disabled={narrowed || undefined} aria-describedby={narrowedBy ?? undefined}
        data-narrowed={narrowed ? 'true' : undefined} onClick={tap}
      >
        <span aria-hidden="true">＋</span> {DOOR_WORD}
      </Button>
    );
  }
  return (
    <ListRow
      className="acct-door"
      aria-label={DOOR_WORD}
      aria-disabled={narrowed || undefined} aria-describedby={narrowedBy ?? undefined}
      data-narrowed={narrowed ? 'true' : undefined} onClick={tap}
    >
      <span className="acct-door-word"><span aria-hidden="true">＋</span> {DOOR_WORD}</span>
      <span className="acct-door-meta" aria-hidden="true">{DOOR_META}</span>
    </ListRow>
  );
}
