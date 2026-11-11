// D-8166 (test box connect plan TC16; spec 2026-11-07-test-box-connect-design.md §2.2 "Connected" and "Blocked", §2.6, §2.7,
// §2.9, §2.10, C7, C9, C13): Settings › Automation › Test box, once a box is connected. The connected card shows the address
// as SET (never its text, D19), the pinned host key's fingerprint and the last act from the ledger, then five controls:
//
//   * **Settings**: the box's 28 rows by family (the verb's display classes: a path, an address or a list shows as set) and the
//     twelve fleet-host rows; a fleet key `ccrc.env` sets is read-only with "Set in ccrc.env"; the four pairing keys show set
//     or not set. Save sends only the keys that changed, to `settings-fleet` and `settings-box`. With runs in progress the box
//     part offers **Apply when idle** (the verb holds it until none is, C13) and **Cancel** while it waits; a run-shaping change
//     says parity will be needed again (§2.8). The page re-reads: what is shown after a save is what the readers answer.
//     **Reset to default** (D-8336) sits on each row a settings file sets: one tap, then the card's one sheet confirms, and the key
//     alone goes as the `unset` list of the same sub, so ccrc takes it out of the file it wrote and the reader answers the key's
//     own default. Not on a default row, a pairing row, a key `ccrc.env` sets, or the two box paths whose default the installer
//     refuses (`BOX_SETTING_FORM_START`); the deny list's reset asks for the step-up as its edit does.
//   * **Repair** re-pushes the installed release; **Apply release to box** (only while the box's release differs, C7) re-runs the
//     installer from the release the box holds. Both are long acts: six phases read from the status, so a reload shows the same.
//   * **Replace** and **Disconnect** each confirm in one sheet that names what is removed (C6) and need the step-up (C14).
//     Replace is Disconnect with `replace`, then step 1 of the connect flow opens (`onReplaced`), and its step 3 shows the new
//     fingerprint (C9 (b)).
//   * **Rotate key** and **Revoke key** (D-8337) confirm in the same sheet and need the step-up. Rotate puts a new access key on
//     the box with the old one and changes nothing when the box does not take it; Revoke is Disconnect plus the key deleted. A
//     line the operator must remove by hand (only public key words) goes to the section (`onKeyNotice`), which shows it above
//     the card, so it outlives this card when Revoke turns the section back to the connect flow.
//
// BLOCKED (spec §2.2): a changed host key, a lost access key or a failed act each show ONE line with the ONE control that
// resolves it (Show the new fingerprint, then Confirm; Show the access line; Try again). A changed host key holds every
// control but Confirm and Disconnect (C9).
//
// WHAT THE CARD NEVER HOLDS. The address: the access-line form asks for it again and forgets it when the line is shown. A
// secret: none crosses (the status carries none). Which fleet key `ccrc.env` sets: the status does not say, so the card learns it
// from the route's `key-in-ccrc-env` refusal (which names the keys) and draws those read-only from then on.
//
// THE THREE WIDTHS (spec §2.2's table, `settings.css`): phone, one column, the controls full width one per row, the last act one
// line, families folded, the sheet scrolling inside itself with Confirm and Cancel pinned; laptop, the controls at the end of the
// state line and the settings a two-column form; wide, the settings' two groups (the box, the fleet host) side by side and the
// ledger's last ten acts beside the state. The band is the card's (`TestBoxSection`'s one read).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QC_ACTIONS, QC_CONSEQUENCE, Sheet, Skeleton, useCancelFirst } from '@ccrc/ui';
import {
  TESTBOX_BOX_KEYS, TESTBOX_PAIRING_KEYS, TESTBOX_PHASED_SUB_MAP, TESTBOX_RUN_SHAPING, fitsTestboxShape, isTestboxLineCode,
  type TestboxAdminFields, type TestboxLineCode, type TestboxAdminSub, type TestboxPhasedSub,
} from '../../../shared/testbox-admin';
import type { BoxSettingRow, TestboxAdminResult } from '../../../shared/api';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import { ApiError } from '../lib/api';
import { testboxRouteText } from '../lib/refusalWords';
import { isRecord } from '../lib/wire';
import { ResultLine, SETTINGS_AMBER_NOTE, useResultLine } from './settingsText';
import { BLANK_CONN, ConnFields, Field, PARTIAL_DISCONNECT, Phases, StateLine, connReady, keyFieldsOf, type Conn } from './TestBoxConnect';
import {
  BOX_SETTING_FAMILIES, BOX_SETTING_FORM_START, FLEET_EDIT_KEYS, PAIRED_BOX_KEYS, TESTBOX_FAMILY_FOLD, actWord, TESTBOX_CONNECT_TEXT, TESTBOX_MANAGE_TEXT, blockedOf, checkWord, codeSentence, ledgerLine, manageRowLine,
  phaseWord, settingLabel, shapeSentence,
} from './testboxAdminWords';
import { useTestboxAdmin } from './useTestboxAdmin';

const T = TESTBOX_MANAGE_TEXT;
const C = TESTBOX_CONNECT_TEXT;
/** A test box act's step-up is learned from the route's refusal, as the connect flow learns it. */
const ASSUME_FRESH = Infinity;
/** The wide band's ledger: the last ten acts (spec §2.10). */
const WIDE_LEDGER_ROWS = 10;

type Band = 'phone' | 'laptop' | 'wide';
const PAIRED_LOCKED: ReadonlySet<string> = new Set(PAIRED_BOX_KEYS);
type Sheeted = 'replace' | 'disconnect' | 'reset' | 'rotate' | 'revoke';
/** The row a Reset to default confirms: its key, and whether it is a fleet-host key. */
interface Resetting { readonly key: string; readonly fleet: boolean }
/** The head over a key line to remove by hand, by the code that carries it: a rotated key's old line only; a revoked key's every
 *  ccrc line (D-8337). */
const HAND_LINE_HEAD: Readonly<Record<TestboxLineCode, string>> = {
  'old-line-kept': T.handLineHeadRotate, 'revoked-box-skipped': T.handLineHead, 'revoked-unpair-failed': T.handLineHead,
};

/** What the section shows above the card after an access key act: a sentence, and the PUBLIC key words to remove by hand, if any,
 *  under the head that says which lines go (a revoke: every ccrc line; a rotate: only the old key's). */
export interface TestboxKeyNotice { readonly sentence: string; readonly line: string | null; readonly head: string | null }

export interface TestBoxManageProps {
  band: Band;
  /** A re-read of the card's block after an act (the section's poll). */
  onChanged?: () => void;
  /** A Replace's disconnect landed: the section opens step 1 of the connect flow. */
  onReplaced?: () => void;
  /** The fleet host's own settings rows, from the nodes the Settings page already polls; null when not reported. */
  fleetRows?: readonly BoxSettingRow[] | null;
  /** A fleet-side save landed: the Settings page re-reads the nodes, so the rows above are the readers' answer. */
  onFleetChanged?: () => void;
  /** The release the box's service runs now (the card's block). **Apply release to box** is shown when it differs from the
   *  tag the box's installer marker names, which the status reports as `installedTag` (C7): tool sync switches the tree and
   *  never rewrites the marker. Null when the box is unmeasured. */
  boxRelease?: string | null;
  /** Runs in progress on the box now, from the card's block: the box part of a save waits for none (C13). */
  runsInProgress?: number;
  /** An access key act left something to say beyond this card's life (D-8337): Revoke's end, or a line to remove by hand. */
  onKeyNotice?: (n: TestboxKeyNotice) => void;
  /** Tests only: the step-up's seams. */
  stepUpDeps?: StepUpDeps;
  /** Tests only: the cadence while a long act runs. */
  runningPollMs?: number;
}

/** The closed `code` a refused act carries, or null. */
function refusalCodeOf(err: unknown): string | null {
  if (!(err instanceof ApiError) || !isRecord(err.body)) return null;
  return typeof err.body.code === 'string' ? err.body.code : null;
}

/** The public key line a refusal names, or null. */
function refusalLineOf(err: unknown): string | null {
  if (!(err instanceof ApiError) || !isRecord(err.body)) return null;
  return typeof err.body.line === 'string' ? err.body.line : null;
}

/** The setting keys a refusal names, only strings. */
function refusalKeysOf(err: unknown): string[] {
  if (!(err instanceof ApiError) || !isRecord(err.body) || !Array.isArray(err.body.keys)) return [];
  return err.body.keys.filter((k): k is string => typeof k === 'string');
}

export function TestBoxManage(p: TestBoxManageProps): ReactNode {
  const { band, onChanged, onReplaced, fleetRows = null, onFleetChanged, boxRelease = null, runsInProgress = 0, onKeyNotice, stepUpDeps, runningPollMs } = p;
  const admin = useTestboxAdmin({ runningPollMs });
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const line = useResultLine();
  const status = admin.status;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [edits, setEdits] = useState<Readonly<Record<string, string>>>({});
  const [ccrcEnv, setCcrcEnv] = useState<ReadonlySet<string>>(new Set());
  const [offerIdle, setOfferIdle] = useState(false);
  const [sheet, setSheet] = useState<Sheeted | null>(null);
  const [resetting, setResetting] = useState<Resetting | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [access, setAccess] = useState<Conn>(BLANK_CONN);
  const [accessLine, setAccessLine] = useState<string | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const cancelRef = useCancelFirst(sheet !== null, true);
  // The last act ended with its box side left to the operator (a partial disconnect, or a line to remove by hand).
  const partial = useRef(false);

  const boxRows = useMemo(() => new Map((status?.boxSettings ?? []).map((r) => [r.key as string, r])), [status?.boxSettings]);
  const fleetMap = useMemo(() => new Map((fleetRows ?? []).map((r) => [r.key as string, r])), [fleetRows]);

  // A re-read of the box's settings lands: what was typed is dropped, so the form shows what the box answered (spec §2.6).
  const settingsAt = status?.boxSettingsAt ?? null;
  // The running tree against the installer's marker: unmeasured, on either side, says nothing.
  const releaseDiffers = boxRelease !== null && boxRelease !== '' && status?.installedTag != null && status.installedTag !== boxRelease;
  useEffect(() => { setOfferIdle(false); }, [settingsAt]);

  /** One act: its answer, or null (a refusal said its sentence on the card's line; a stale step-up shows the step). A refusal
   *  is handed to `refused` first, so the caller can read the keys it names. */
  const run = async (sub: TestboxAdminSub, fields: TestboxAdminFields, refused?: (err: unknown) => void): Promise<TestboxAdminResult | null> => {
    line.clear();
    partial.current = false;
    let landed: TestboxAdminResult | 'unreadable' | undefined;
    try {
      const outcome = await stepUp.runAct(async () => { landed = await admin.act(sub, fields); });
      if (outcome === 'step-up') return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      refused?.(err);
      // The fleet side is clean whether or not the box answered: the box side was skipped or did not finish, and the status is read again.
      const code = refusalCodeOf(err);
      // An access key act that is done on this side and leaves a line on the box (D-8337): the section shows it, with its key words.
      if (code !== null && isTestboxLineCode(code)) {
        partial.current = true;
        admin.reload(); onChanged?.();
        const keyLine = refusalLineOf(err);
        onKeyNotice?.({ sentence: codeSentence(code), line: keyLine, head: keyLine === null ? null : HAND_LINE_HEAD[code] });
        return {};
      }
      if (code !== null && PARTIAL_DISCONNECT.has(code)) { admin.reload(); onChanged?.(); line.say(codeSentence(code), 'refusal'); return {}; }
      line.say(testboxRouteText(err) ?? C.unreadable, 'refusal');
      return null;
    }
    if (landed === undefined || landed === 'unreadable') { line.say(C.unknown, 'refusal'); return null; }
    onChanged?.();
    return landed;
  };

  if (admin.failure?.dark != null) return null;
  if (status === null) {
    return (
      <div className="testbox-manage" data-testbox="manage" data-band={band}>
        {admin.loading ? <Skeleton lines={2} /> : <p className={SETTINGS_AMBER_NOTE} role="status">{admin.failure?.text ?? C.unreadable}</p>}
      </div>
    );
  }
  // Not connected: the connect flow's card (the section mounts it), not this one.
  if (!status.connected) return null;

  const size = band === 'phone' ? 'full' : 'fit';
  const act = status.act;
  const running = act?.outcome === 'running';
  const phased = act !== null && Object.hasOwn(TESTBOX_PHASED_SUB_MAP, act.sub) ? (act.sub as TestboxPhasedSub) : null;
  const busy = admin.busy || checking || running;
  const rawBlocked = blockedOf(status);
  // A lost access key the operator has just fixed and checked stops blocking until the status says otherwise.
  const blocked = accessChecked && rawBlocked?.kind === 'access' ? null : rawBlocked;
  const hostKeyHeld = blocked?.kind === 'host-key';
  const lastEvent = admin.events[0];

  // -- settings ------------------------------------------------------------------------------------------------------
  const originalOf = (key: string, fleet: boolean): string => manageRowLine((fleet ? fleetMap : boxRows).get(key)).original;
  const changed = (keys: readonly string[], fleet: boolean): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const k of keys) if (Object.hasOwn(edits, k) && edits[k] !== originalOf(k, fleet)) out[k] = edits[k]!;
    return out;
  };
  const fleetKeys = FLEET_EDIT_KEYS.filter((k) => !ccrcEnv.has(k));
  // The four pairing keys are shown and never sent: only Replace changes them (`TESTBOX_PAIRED_BOX_KEYS`).
  const editableBoxKeys = TESTBOX_BOX_KEYS.filter((k) => !PAIRED_BOX_KEYS.includes(k));
  const changedBox = changed(editableBoxKeys, false);
  const changedFleet = changed(fleetKeys, true);
  const problemOf = (key: string, value: string): string | null => (fitsTestboxShape(key, value) ? null : shapeSentence(key));
  const problems = Object.entries({ ...changedBox, ...changedFleet }).filter(([k, v]) => problemOf(k, v) !== null);
  const changedCount = Object.keys(changedBox).length + Object.keys(changedFleet).length;
  const shapesRuns = Object.keys(changedBox).some((k) => TESTBOX_RUN_SHAPING.includes(k));
  const waitsForIdle = Object.keys(changedBox).length > 0 && (runsInProgress > 0 || offerIdle);
  const settingsRunning = running && act?.sub === 'settings-box';

  const save = async (): Promise<void> => {
    if (Object.keys(changedFleet).length > 0) {
      const r = await run('settings-fleet', { settings: changedFleet }, (err) => {
        const keys = refusalKeysOf(err).filter((k) => FLEET_EDIT_KEYS.includes(k));
        if (refusalCodeOf(err) === 'key-in-ccrc-env' && keys.length > 0) {
          setCcrcEnv((cur) => new Set([...cur, ...keys]));
          setEdits((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !keys.includes(k))));
        }
      });
      if (r === null) return;
      setEdits((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !Object.hasOwn(changedFleet, k))));
      onFleetChanged?.();
    }
    if (Object.keys(changedBox).length > 0) {
      const r = await run('settings-box', waitsForIdle ? { settings: changedBox, whenIdle: true } : { settings: changedBox }, (err) => {
        if (refusalCodeOf(err) === 'runs-in-progress') setOfferIdle(true);
      });
      if (r === null) return;
      setEdits({});
    }
    // A box change is a detached act: its phases show below, so this says only that it began (or that it waits).
    line.say(Object.keys(changedBox).length === 0 ? T.saved : waitsForIdle ? T.waiting : T.applying);
  };

  // -- Reset to default (D-8336) ------------------------------------------------------------------------------------
  /** Whether a row offers Reset to default: an editable key a settings file sets (a default row has nothing to reset, an
   *  unmeasured one is unknown), and, on the box, one whose declared default the installer takes. */
  const resettable = (key: string, fleet: boolean): boolean => {
    if (fleet ? ccrcEnv.has(key) || !FLEET_EDIT_KEYS.includes(key) : PAIRED_LOCKED.has(key) || Object.hasOwn(BOX_SETTING_FORM_START, key)) return false;
    const row = (fleet ? fleetMap : boxRows).get(key);
    return row !== undefined && row.state !== 'unmeasured' && (row.from === 'file' || row.from === 'empty');
  };
  const openReset = (key: string, fleet: boolean): void => { line.clear(); setResetting({ key, fleet }); setSheet('reset'); };
  const closeSheet = (): void => { setSheet(null); setResetting(null); };
  const resetWaits = resetting !== null && !resetting.fleet && (runsInProgress > 0 || offerIdle);
  const resetHeld = resetting !== null && resetting.fleet && ccrcEnv.has(resetting.key);
  const dropEdit = (key: string): void => setEdits((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== key)));

  const confirmReset = async (): Promise<void> => {
    if (resetting === null) return;
    const { key, fleet } = resetting;
    if (fleet) {
      const r = await run('settings-fleet', { unset: [key] }, (err) => {
        const keys = refusalKeysOf(err).filter((k) => FLEET_EDIT_KEYS.includes(k));
        if (refusalCodeOf(err) === 'key-in-ccrc-env' && keys.length > 0) {
          setCcrcEnv((cur) => new Set([...cur, ...keys]));
          setEdits((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !keys.includes(k))));
        }
      });
      if (r === null) return;
      dropEdit(key);
      closeSheet();
      onFleetChanged?.();
      line.say(T.resetDone);
      return;
    }
    const waits = resetWaits;
    const r = await run('settings-box', waits ? { unset: [key], whenIdle: true } : { unset: [key] }, (err) => {
      if (refusalCodeOf(err) === 'runs-in-progress') setOfferIdle(true);
    });
    if (r === null) return;
    dropEdit(key);
    closeSheet();
    line.say(waits ? T.waiting : T.applying);
  };

  const cancelWait = async (): Promise<void> => {
    const r = await run('cancel', {});
    if (r === null) return;
    // Measured from the reply: once the act is past its wait the change lands, and the card says so.
    line.say(r.cancelled === true ? T.cancelled : T.cancelTooLate);
  };

  // -- the controls --------------------------------------------------------------------------------------------------
  const longAct = async (sub: 'repair' | 'apply-release'): Promise<void> => { await run(sub, {}); };

  const confirmSheet = async (): Promise<void> => {
    if (sheet === 'reset') { await confirmReset(); return; }
    if (sheet === 'rotate' || sheet === 'revoke') { await keyAct(sheet); return; }
    const replacing = sheet === 'replace';
    const r = await run('disconnect', replacing ? { replace: true } : {});
    if (r === null) return;
    setSheet(null);
    setSettingsOpen(false);
    setEdits({});
    if (replacing) onReplaced?.();
  };

  /** Rotate or Revoke the access key (D-8337): one sheet, the step-up inside it, one act. */
  const keyAct = async (kind: 'rotate' | 'revoke'): Promise<void> => {
    const r = await run(kind === 'rotate' ? 'key-rotate' : 'key-revoke', {});
    if (r === null) return;
    setSheet(null);
    if (partial.current) return;
    if (kind === 'rotate') { line.say(T.rotated); return; }
    setSettingsOpen(false);
    setEdits({});
    onKeyNotice?.({ sentence: T.revoked, line: null, head: null });
  };

  // -- blocked: the one control that resolves each -------------------------------------------------------------------
  const showFingerprint = async (): Promise<void> => {
    setChecking(true);
    try {
      const r = await run('probe', {});
      if (r?.fingerprint !== undefined) setFingerprint(r.fingerprint);
    } finally { setChecking(false); }
  };
  const confirmFingerprint = async (): Promise<void> => {
    if (fingerprint === null) return;
    setChecking(true);
    try {
      const r = await run('pin', { fingerprint });
      if (r !== null) setFingerprint(null);
    } finally { setChecking(false); }
  };
  const accessReady = connReady(access);
  const showAccessLine = async (): Promise<void> => {
    const r = await run('key', keyFieldsOf(access));
    if (r?.line === undefined) return;
    // The address has done its work: it is forgotten with the form.
    setAccess(BLANK_CONN);
    setAccessLine(r.line);
    setCopied('no');
  };
  const checkAccess = async (): Promise<void> => {
    setChecking(true);
    try {
      const r = await run('preflight', {});
      if (r === null) return;
      if (r.pass === true) { setAccessChecked(true); setAccessLine(null); line.say(T.accessChecked); return; }
      const first = (r.checks ?? []).find((c) => !c.ok);
      line.say(first === undefined ? C.unreadable : `${checkWord(first.check)}: ${codeSentence(first.code)}`, 'refusal');
    } finally { setChecking(false); }
  };
  const copy = (text: string): void => {
    try {
      void navigator.clipboard.writeText(text).then(() => setCopied('yes'), () => setCopied('failed'));
    } catch { setCopied('failed'); }
  };
  const tryAgain = (): void => {
    if (blocked?.kind !== 'failed') return;
    switch (blocked.sub) {
      case 'repair': void longAct('repair'); break;
      case 'apply-release': void longAct('apply-release'); break;
      case 'disconnect': setSheet('disconnect'); break;
      default: setSettingsOpen(true);
    }
  };

  const hostKeyText = status.fingerprint === null ? (status.hostKey === 'changed' ? T.hostKeyChanged : T.hostKeyNone) : status.fingerprint;
  const blockedBody = ((): ReactNode => {
    if (blocked === null) return null;
    if (blocked.kind === 'host-key') {
      return (
        <div className="testbox-connect-body" data-testbox="blocked" data-blocked="host-key">
          <StateLine band={band} text={T.blockedHostKey}>
            {fingerprint === null && (
              <Button variant="primary" size={size} disabled={busy} onClick={() => void showFingerprint()} data-testbox="show-fingerprint">{T.showNewFingerprint}</Button>
            )}
          </StateLine>
          {fingerprint !== null && (
            <>
              <p className="settings-note">{T.newFingerprintLabel}</p>
              <code className="testbox-key-line" data-testbox="new-fingerprint">{fingerprint}</code>
              <p className="settings-note">{C.fingerprintCompare}</p>
              <Button variant="primary" size={size} disabled={busy} onClick={() => void confirmFingerprint()} data-testbox="confirm-fingerprint">{T.confirmNewFingerprint}</Button>
            </>
          )}
        </div>
      );
    }
    if (blocked.kind === 'access') {
      return (
        <div className="testbox-connect-body" data-testbox="blocked" data-blocked="access">
          <StateLine band={band} text={accessLine === null ? T.blockedAccess : T.accessWhere}>
            {accessLine === null && (
              <Button variant="primary" size={size} disabled={busy || !accessReady} onClick={() => void showAccessLine()} data-testbox="show-access">{T.showAccessLine}</Button>
            )}
          </StateLine>
          {accessLine === null ? (
            <>
              <p className="settings-note">{T.accessIntro}</p>
              <div className="testbox-access">
                <ConnFields conn={access} setConn={setAccess} withSource />
              </div>
            </>
          ) : (
            <>
              <code className="testbox-key-line" data-testbox="access-line">{accessLine}</code>
              <div className="testbox-manage-row">
                <Button variant="ghost" size={size} onClick={() => copy(accessLine)} data-testbox="copy-access">{copied === 'yes' ? C.copied : C.copy}</Button>
                <Button variant="primary" size={size} disabled={busy} onClick={() => void checkAccess()} data-testbox="check-access">{T.checkAccess}</Button>
              </div>
              {copied === 'failed' && <p className={SETTINGS_AMBER_NOTE} role="status">{C.copyFailed}</p>}
            </>
          )}
        </div>
      );
    }
    return (
      <div className="testbox-connect-body" data-testbox="blocked" data-blocked="failed">
        <StateLine band={band} text={T.blockedFailed(blocked.phase === null ? actWord(blocked.sub) : phaseWord(blocked.phase), codeSentence(blocked.code))}>
          <Button variant="primary" size={size} disabled={busy} onClick={tryAgain} data-testbox="blocked-try-again">{T.tryAgain}</Button>
        </StateLine>
      </div>
    );
  })();

  // What the confirm sheet says: Rotate changes nothing it lists as removed; Revoke and the two disconnects list both sides.
  const sheetBody: { removed: readonly string[] | null; lines: readonly string[] } =
    sheet === 'rotate' ? { removed: null, lines: [T.rotateHow, T.rotateThen, T.rotateKept] }
      : sheet === 'revoke' ? { removed: [T.revokeBox, T.revokeFleet], lines: [T.switchOff, T.revokeThen] }
        : { removed: [T.removedBox, T.removedFleet], lines: [`${T.keptHead}: ${T.kept}`, T.switchOff, sheet === 'replace' ? `${T.rebuild} ${T.replaceThen}` : T.rebuild] };
  const ledgerRows = band === 'wide' ? admin.events.slice(0, WIDE_LEDGER_ROWS) : [];
  const resetBody = resetting === null ? null : (
    <>
      <p className={QC_CONSEQUENCE}>{T.resetWhat(settingLabel(resetting.key))}</p>
      <p className={QC_CONSEQUENCE}>{resetting.fleet ? T.resetFleet : T.resetBox}</p>
      {!resetting.fleet && TESTBOX_RUN_SHAPING.includes(resetting.key) && <p className={QC_CONSEQUENCE}>{T.parityAgain}</p>}
      {!resetting.fleet && runsInProgress > 0 && <p className={QC_CONSEQUENCE}>{T.runsNote}</p>}
    </>
  );
  const sheetNode = (
    <Sheet
      open={sheet !== null}
      onClose={closeSheet}
      title={sheet === 'reset' ? T.resetTitle : sheet === 'replace' ? T.replaceTitle : sheet === 'rotate' ? T.rotateTitle : sheet === 'revoke' ? T.revokeTitle : T.disconnectTitle}
      size="sm"
      initialFocus={cancelRef}
      footer={(
        <div className={QC_ACTIONS}>
          <Button variant={sheet === 'reset' ? 'primary' : 'danger'} disabled={busy || stepUp.needed || resetHeld} onClick={() => void confirmSheet()} data-testbox="sheet-confirm">
            {sheet === 'reset' ? (resetWaits ? T.applyWhenIdle : T.resetToDefault) : sheet === 'replace' ? T.confirmReplace : sheet === 'rotate' ? T.confirmRotate : sheet === 'revoke' ? T.confirmRevoke : T.confirmDisconnect}
          </Button>
          <Button ref={cancelRef} variant="ghost" onClick={closeSheet} data-testbox="sheet-cancel">{T.sheetCancel}</Button>
        </div>
      )}
    >
      <div data-testbox="sheet" data-sheet={sheet ?? undefined}>
        {sheet === 'reset' ? resetBody : (
          <>
            {sheetBody.removed !== null && (
              <>
                <p className={QC_CONSEQUENCE}>{T.removedHead}</p>
                <ul className="testbox-sheet-list">
                  {sheetBody.removed.map((t) => <li key={t} className={QC_CONSEQUENCE}>{t}</li>)}
                </ul>
              </>
            )}
            {sheetBody.lines.map((t) => <p key={t} className={QC_CONSEQUENCE}>{t}</p>)}
          </>
        )}
        {sheet !== null && <ConfirmItsYou stepUp={stepUp} subject="the test box" />}
        {sheet !== null && <ResultLine line={line.line} />}
      </div>
    </Sheet>
  );

  return (
    <div className="testbox-manage" data-testbox="manage" data-band={band}>
      <div className="testbox-manage-grid">
        <div className="testbox-manage-main">
          <dl className="testbox-manage-state" data-testbox="manage-state">
            <StateRow term={T.addressLabel}><span data-testbox="address">{T.addressSet}</span></StateRow>
            <StateRow term={T.hostKeyLabel}><code className="testbox-fingerprint" data-testbox="manage-fingerprint">{hostKeyText}</code></StateRow>
            <StateRow term={T.lastAct}><span data-testbox="last-act">{lastEvent === undefined ? T.noActs : ledgerLine(lastEvent)}</span></StateRow>
          </dl>
          {blockedBody}
          <div className="testbox-manage-controls" data-testbox="manage-controls">
            <Button variant="ghost" size={size} disabled={hostKeyHeld} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((o) => !o)} data-testbox="settings-toggle">
              {settingsOpen ? T.settingsClose : T.settings}
            </Button>
            <Button variant="ghost" size={size} disabled={hostKeyHeld || busy} onClick={() => void longAct('repair')} data-testbox="repair">
              {running && act?.sub === 'repair' ? T.repairing : T.repair}
            </Button>
            <Button variant="ghost" size={size} disabled={hostKeyHeld || busy} onClick={() => setSheet('rotate')} data-testbox="rotate-key">{T.rotateKey}</Button>
            <Button variant="ghost" size={size} disabled={hostKeyHeld || busy} onClick={() => setSheet('replace')} data-testbox="replace">{T.replace}</Button>
            <Button variant="danger" size={size} disabled={busy} onClick={() => setSheet('disconnect')} data-testbox="disconnect">{T.disconnect}</Button>
            <Button variant="danger" size={size} disabled={busy} onClick={() => setSheet('revoke')} data-testbox="revoke-key">{T.revokeKey}</Button>
            {releaseDiffers && (
              <Button variant="ghost" size={size} disabled={hostKeyHeld || busy} onClick={() => void longAct('apply-release')} data-testbox="apply-release">
                {running && act?.sub === 'apply-release' ? T.applyingRelease : T.applyRelease}
              </Button>
            )}
          </div>
          {releaseDiffers && <p className="settings-note" data-testbox="apply-release-why">{T.applyReleaseWhy}</p>}
          {running && phased !== null && act !== null && (
            <>
              <Phases sub={phased} act={act} />
              {settingsRunning && act?.phase === 'wait' && (
                <>
                  <p className="settings-note" data-testbox="waiting">{T.waiting}</p>
                  <Button variant="ghost" size={size} disabled={admin.busy} onClick={() => void cancelWait()} data-testbox="cancel-wait">{T.cancel}</Button>
                </>
              )}
            </>
          )}
          {sheet === null && <ConfirmItsYou stepUp={stepUp} subject="the test box" />}
          {sheet === null && <ResultLine line={line.line} />}
        </div>
        {band === 'wide' && (
          <aside className="testbox-ledger" data-testbox="manage-ledger" aria-label={T.recent}>
            <p className="settings-note">{T.recent}</p>
            {ledgerRows.length === 0 ? <p className="settings-note">{T.noActs}</p> : (
              <ul className="testbox-checks">{ledgerRows.map((e) => <li key={e.id}>{ledgerLine(e)}</li>)}</ul>
            )}
          </aside>
        )}
      </div>
      {settingsOpen && !hostKeyHeld && (
        <div className="testbox-settings" data-testbox="settings" data-band={band}>
          <p className="settings-note">{T.settingsIntro}</p>
          <div className="testbox-settings-groups">
            <section className="testbox-settings-group" data-group="box" aria-label={T.boxHead}>
              <GroupHead text={T.boxHead} />
              {BOX_SETTING_FAMILIES.map((f) => (
                <SettingFamily key={f.id} id={f.id} title={f.title} keys={f.keys} rows={boxRows} edits={edits} problem={problemOf}
                  readOnly={PAIRED_LOCKED} readOnlyText={T.pairingLocked} onEdit={(k, v) => setEdits((cur) => ({ ...cur, [k]: v }))}
                  reset={{ can: (k) => resettable(k, false), open: (k) => openReset(k, false), size, disabled: busy }} />
              ))}
              {status.boxSettings === null && <p className="settings-note" data-testbox="box-none">{T.boxNone}</p>}
            </section>
            <section className="testbox-settings-group" data-group="fleet" aria-label={T.fleetHead}>
              <GroupHead text={T.fleetHead} />
              {fleetRows === null && <p className="settings-note" data-testbox="fleet-none">{T.fleetNone}</p>}
              <SettingFamily id="fleet" title={T.fleetHead} keys={FLEET_EDIT_KEYS} rows={fleetMap} edits={edits} problem={problemOf} readOnly={ccrcEnv}
                readOnlyText={T.setInCcrcEnv} onEdit={(k, v) => setEdits((cur) => ({ ...cur, [k]: v }))}
                reset={{ can: (k) => resettable(k, true), open: (k) => openReset(k, true), size, disabled: busy }} />
              <Family id="pairing" title={T.pairingHead}>
                <p className="settings-note">{T.pairingNote}</p>
                <dl className="testbox-pairing">
                  {TESTBOX_PAIRING_KEYS.map((key) => {
                    const row = fleetMap.get(key);
                    const isSet = row !== undefined && row.state === 'ok' && row.from !== 'default' && row.from !== 'empty';
                    return <StateRow key={key} id={key} term={settingLabel(key)}>{isSet ? T.pairingSet : T.pairingNotSet}</StateRow>;
                  })}
                </dl>
              </Family>
            </section>
          </div>
          {shapesRuns && <p className="settings-note" data-testbox="parity-again">{T.parityAgain}</p>}
          {runsInProgress > 0 && Object.keys(changedBox).length > 0 && <p className="settings-note" data-testbox="runs-note">{T.runsNote}</p>}
          {problems.length > 0 && <p className={SETTINGS_AMBER_NOTE} role="status">{problemOf(problems[0]![0], problems[0]![1])}</p>}
          <Button variant="primary" size={size} disabled={busy || changedCount === 0 || problems.length > 0} onClick={() => void save()} data-testbox="settings-save">
            {admin.busy ? T.saving : waitsForIdle ? T.applyWhenIdle : T.save}
          </Button>
        </div>
      )}
      {sheetNode}
    </div>
  );
}

/** A folded family of settings. */
function Family({ id, title, children }: { id: string; title: string; children: ReactNode }): ReactNode {
  return (
    <details className={TESTBOX_FAMILY_FOLD} data-family={id}>
      <summary className="settings-note">{title}</summary>
      {children}
    </details>
  );
}

/** A group's heading inside the settings panel. */
function GroupHead({ text }: { text: string }): ReactNode {
  return <p className="settings-note testbox-settings-head">{text}</p>;
}

/** One row of the state list: a term and what it reads. */
function StateRow({ term, id, children }: { term: string; id?: string; children: ReactNode }): ReactNode {
  return (
    <div data-pairing={id}>
      <dt className="settings-note">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A row's Reset to default (D-8336): whether the row offers it, the tap that opens its confirm, and how it is drawn. */
interface RowReset {
  readonly can: (key: string) => boolean;
  readonly open: (key: string) => void;
  readonly size: 'full' | 'fit';
  readonly disabled: boolean;
}

/** A folded family of setting rows, each from `rows`, with `readOnly` keys drawn disabled and noted. */
function SettingFamily({ id, title, keys, rows, edits, problem, readOnly, readOnlyText, onEdit, reset }: {
  id: string; title: string; keys: readonly string[]; rows: ReadonlyMap<string, BoxSettingRow>; edits: Readonly<Record<string, string>>;
  problem: (key: string, value: string) => string | null; readOnly?: ReadonlySet<string>; readOnlyText?: string;
  onEdit: (key: string, value: string) => void; reset: RowReset;
}): ReactNode {
  return (
    <Family id={id} title={title}>
      <div className="testbox-form">
        {keys.map((key) => (
          <SettingRow key={key} name={key} line={manageRowLine(rows.get(key))} edit={edits[key]} problem={problem}
            readOnlyNote={readOnly?.has(key) === true ? readOnlyText ?? T.setInCcrcEnv : null} onEdit={(v) => onEdit(key, v)}
            reset={reset.can(key) ? reset : null} />
        ))}
      </div>
    </Family>
  );
}

/** One setting: its name, what it reads now, an input that starts from the value (blank for a row only shown as set), and its
 *  Reset to default when the row offers one. */
function SettingRow({ name, line, edit, problem, readOnlyNote, onEdit, reset }: {
  name: string;
  line: { shown: string; original: string };
  edit: string | undefined;
  problem: (key: string, value: string) => string | null;
  readOnlyNote?: string | null;
  onEdit: (v: string) => void;
  reset: RowReset | null;
}): ReactNode {
  const dirty = edit !== undefined && edit !== line.original;
  const action = reset === null ? null : (
    <Button variant="ghost" size={reset.size} className="testbox-reset" disabled={reset.disabled} onClick={() => reset.open(name)}
      aria-label={`${T.resetToDefault}: ${settingLabel(name)}`} data-testbox="reset-default">{T.resetToDefault}</Button>
  );
  return (
    <Field setting={name} label={settingLabel(name)} now={line.shown} value={edit ?? line.original} placeholder={line.original === '' ? T.keepSet : ''}
      error={dirty ? problem(name, edit) : null} disabled={readOnlyNote != null} footnote={readOnlyNote ?? null} onChange={onEdit} action={action} />
  );
}

/** What an access key act leaves to say (D-8337), drawn by the section above the card: its sentence and, when ccrc's line may still be
 *  on a box, that key's PUBLIC words with Copy, then Done. Never a private key: the route passes one printable line only. */
export function TestBoxKeyNotice({ band, notice, onDone }: { band: Band; notice: TestboxKeyNotice; onDone: () => void }): ReactNode {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const size = band === 'phone' ? 'full' : 'fit';
  const copy = (text: string): void => {
    try {
      void navigator.clipboard.writeText(text).then(() => setCopied('yes'), () => setCopied('failed'));
    } catch { setCopied('failed'); }
  };
  return (
    <div className="testbox-key-notice" data-testbox="key-notice" data-band={band} role="status">
      <p className="settings-note">{notice.sentence}</p>
      {notice.line !== null && (
        <>
          <p className="settings-note">{notice.head ?? T.handLineHead}</p>
          <code className="testbox-key-line" data-testbox="key-notice-line">{notice.line}</code>
        </>
      )}
      <div className="testbox-key-notice-row">
        {notice.line !== null && (
          <Button variant="ghost" size={size} onClick={() => copy(notice.line!)} data-testbox="key-notice-copy">{copied === 'yes' ? C.copied : C.copy}</Button>
        )}
        <Button variant="ghost" size={size} onClick={onDone} data-testbox="key-notice-done">{T.noticeDone}</Button>
      </div>
      {copied === 'failed' && <p className={SETTINGS_AMBER_NOTE} role="status">{C.copyFailed}</p>}
    </div>
  );
}
