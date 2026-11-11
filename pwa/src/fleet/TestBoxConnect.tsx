// D-8166 (test box connect plan TC15; spec 2026-11-07-test-box-connect-design.md §2.2, §5.1): Settings › Automation › Test box,
// "Connect a test box", steps 1 to 6, from nothing to a box that has passed parity. Every act goes through the connect
// routes (`useTestboxAdmin`); the card holds no secret and no shell: the box's address is typed once into step 1 and leaves
// this component's memory when the install has started, the access key's PRIVATE half never leaves the fleet host (only its
// public line is shown), and the host key is pinned only on the operator's Confirm.
//
//   1  the address, the port and the login, checked as typed; nothing is sent to the box.
//   2  Generate access key (step-up) shows the public line, Copy, and where it goes; "I have added it" moves on.
//   3  Check the box probes and shows the fingerprint; Confirm (step-up) pins it, and the preflight runs and lists each check.
//   4  the box's 28 settings in four folded families at their defaults (the listen address filled from the address), and one
//      to four repository rows, offered from the fleet's own repositories.
//   5  Install (step-up): six phases with their times, read from the status, so a reload shows the same.
//   6  Run parity and its result. The switch itself stays on the card's own control, disabled until parity passes.
//
// WHICH STEP IS CURRENT is `stepOf(status, seen)`: the status the verb wrote, plus the little the card alone knows. A reload
// loses `seen` and so only ever moves the card back a step; it never invents progress. With the account gate dark (auth off,
// an insecure origin) the card says sign-in is required and draws no button (§5.1).
//
// THE THREE WIDTHS (spec §2.2's table, `settings.css`): phone, one column with the steps a numbered list and only the
// current one open; laptop, the step list on the left and the current step on the right, the act's button at the end of its
// state line; wide, a third area with the ledger's recent acts. The band is the card's (`TestBoxSection`'s one read).
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Skeleton, TextInput } from '@ccrc/ui';
import { parityArmable, parityCurrentOf, TESTBOX_ADMIN_PHASES, TESTBOX_BOX_KEYS, TESTBOX_REPO_ROWS_MAX, fitsTestboxShape, isBoxAddress, isLoginUser, isPrivateNetworkAddress, isSshPort,
  type TestboxAdminFields, type TestboxAdminStatus, type TestboxAdminSub, type TestboxPhasedSub } from '../../../shared/testbox-admin';
import type { TestboxAdminResult, TestboxEventRow } from '../../../shared/api';
import { parseRepoRow } from '../../../shared/testbox';
import { ConfirmItsYou } from '../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../accounts/useStepUp';
import { ApiError } from '../lib/api';
import { testboxRouteText } from '../lib/refusalWords';
import { ResultLine, SETTINGS_AMBER_NOTE, useResultLine } from './settingsText';
import {
  BOX_SETTING_DEFAULTS, BOX_SETTING_FAMILIES, FROM_MISMATCH, TESTBOX_FAMILY_FOLD, GIT_HOST_BASE, TESTBOX_CONNECT_TEXT, TESTBOX_DEFAULT_RUNNER, TESTBOX_LISTEN_KEY, actWord, boxSettingStart, checkWord,
  codeSentence, isIpLiteral, isPublicIpLiteral, listenFor, listenHostOf, phaseTime, phaseWord, settingLabel, shapeSentence, stepOf, type TestboxStepSeen,
} from './testboxAdminWords';
import { useTestboxAdmin } from './useTestboxAdmin';
import { loadProjects } from './useProjectRows';

const T = TESTBOX_CONNECT_TEXT;
/** A test box act's step-up is learned from the route's refusal, the way the Linear card learns it. */
const ASSUME_FRESH = Infinity;
const PRIMARY_REPO_ROWS = 1;
const REPO_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REPO_URL = /^(?:https|ssh):\/\/[^\s@/]+(?:@[^\s/]+)?\/[^\s]+$/;
const COMMAND_HEAD = /^[^\s]+(?: [^\s]+)*$/;
const utcMinute = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

type Band = 'phone' | 'laptop' | 'wide';

/** What step 1 types and the access-line step may type again: the address is the card's only copy of it and is forgotten once the
 *  install has started. `source` is the address the box sees ccrc connect from, only when the box refused the key (spec §5.1). */
export interface Conn { address: string; port: string; login: string; source: string }
export const BLANK_CONN: Conn = { address: '', port: '22', login: 'root', source: '' };
/** The fleet side of a disconnect is clean whether or not the box side finished: its two refusals say what is left. */
export const PARTIAL_DISCONNECT: ReadonlySet<string> = new Set(['box-side-skipped', 'unpair-failed']);
function refusalCodeOf(err: unknown): string | null {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || err.body === null) return null;
  const code = (err.body as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
/** The fields of one `key` call from what was typed. */
export function keyFieldsOf(c: Conn): TestboxAdminFields {
  const source = c.source.trim();
  return { address: c.address.trim(), port: c.port.trim(), user: c.login.trim(), ...(source === '' ? {} : { source }) };
}
/** Whether what was typed may be sent (`source` is optional, an IP literal when given). */
export function connReady(c: Conn): boolean {
  const source = c.source.trim();
  return isBoxAddress(c.address.trim()) && !isPublicIpLiteral(c.address.trim()) && isSshPort(c.port.trim()) && isLoginUser(c.login.trim())
    && (source === '' || isIpLiteral(source));
}

interface RepoDraft { name: string; fetchUrl: string; pkg: string; inputs: string; command: string }
const blankRepo = (): RepoDraft => ({ name: '', fetchUrl: '', pkg: '', inputs: '', command: TESTBOX_DEFAULT_RUNNER });

/** A repository the fleet already knows: its name and the fetch URL the card offers. */
interface Offer { readonly name: string; readonly fetchUrl: string }

/** The row's JSON object for one draft, with the mirror under the box's root. */
function rowOf(d: RepoDraft, root: string): Record<string, unknown> {
  const inputs = d.inputs.trim() === '' ? [`${d.pkg}/package.json`, `${d.pkg}/package-lock.json`] : d.inputs.trim().split(/\s+/);
  return {
    name: d.name, fetchUrl: d.fetchUrl, mirrorPath: `${root.replace(/\/+$/, '')}/mirrors/${d.name}.git`,
    packages: [{ name: d.pkg, installInputs: inputs, commands: [d.command] }], buildOutputs: [], systemTools: [],
  };
}

/** What is wrong with one repository draft, by field; empty for a row that parses. */
function repoProblems(d: RepoDraft, root: string): Partial<Record<keyof RepoDraft | 'row', string>> {
  const out: Partial<Record<keyof RepoDraft | 'row', string>> = {};
  if (!REPO_NAME.test(d.name)) out.name = T.badRepoName;
  if (!REPO_URL.test(d.fetchUrl)) out.fetchUrl = T.badRepoUrl;
  if (!REPO_NAME.test(d.pkg)) out.pkg = T.badRepoName;
  if (!COMMAND_HEAD.test(d.command)) out.command = T.badRepoWord;
  if (Object.keys(out).length === 0 && !parseRepoRow(JSON.stringify(rowOf(d, root))).ok) out.row = T.badRepoRow;
  return out;
}

/** The settings the install sends: every non-blank value that is not its default, and the listen address, which is always sent. */
function settingsToSend(values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TESTBOX_BOX_KEYS) {
    const v = (values[key] ?? '').trim();
    if (v !== '' && (v !== BOX_SETTING_DEFAULTS[key] || key === TESTBOX_LISTEN_KEY)) out[key] = v;
  }
  return out;
}

/** What is wrong with a setting value as typed, or null. A blank value keeps its default, except the listen address. */
function settingProblem(key: string, value: string): string | null {
  const v = value.trim();
  if (v === '') return key === TESTBOX_LISTEN_KEY ? T.needListen : null;
  if (!fitsTestboxShape(key, v)) return shapeSentence(key);
  // The service has no TLS and the firewall matches its listen address only: a listen address that is no private IP literal is
  // refused by Connect, so the card says so as it is typed.
  if (key === TESTBOX_LISTEN_KEY) {
    const host = listenHostOf(v);
    if (host === null || !isPrivateNetworkAddress(host)) return T.listenNotPrivate;
  }
  return null;
}

/** Parity's word from the status alone: the same rule the block's admin applies (`adminOfStatus`). */
function parityWord(s: TestboxAdminStatus): 'none' | 'pass' | 'fail' | 'stale' {
  const p = s.parity;
  if (p === null) return 'none';
  if (p.result === 'fail') return 'fail';
  return parityArmable(p, parityCurrentOf(s)) ? 'pass' : 'stale';
}

export interface TestBoxConnectProps {
  band: Band;
  /** A re-read of the card's block after an act (the section's poll). */
  onChanged?: () => void;
  /** Tests only: the step-up's seams. */
  stepUpDeps?: StepUpDeps;
  /** Tests only: the cadence while a long act runs. */
  runningPollMs?: number;
  /** Start at step 1 with no "Connect a test box" tap first: Replace has just removed the old box (TC16, spec §2.9). */
  begin?: boolean;
  /** What the section's block says about the box now (connected, host key, parity and the last act, as one string). This flow's
   *  status is its own read, so when the connected card beside it acts (Replace, Disconnect, Repair), the block moves first and
   *  this flow re-reads on the change: it never draws the old box's state over the new one. */
  sync?: string;
}

export function TestBoxConnect({ band, onChanged, stepUpDeps, runningPollMs, begin = false, sync }: TestBoxConnectProps): ReactNode {
  const admin = useTestboxAdmin({ runningPollMs });
  const stepUp = useStepUp(ASSUME_FRESH, stepUpDeps);
  const line = useResultLine();
  const status = admin.status;

  const reload = admin.reload;
  const lastSync = useRef(sync);
  useEffect(() => {
    if (lastSync.current === sync) return;
    lastSync.current = sync;
    reload();
  }, [sync, reload]);

  const [begun, setBegun] = useState(begin);
  // A Replace that lands while this flow is already mounted (a connected box whose parity has not passed) opens step 1 too.
  useEffect(() => { if (begin) setBegun(true); }, [begin]);
  const [seen, setSeen] = useState<TestboxStepSeen>({});
  const [conn, setConn] = useState<Conn>(BLANK_CONN);
  const [addressDone, setAddressDone] = useState(false);
  const [keyLine, setKeyLine] = useState<{ text: string; fixed: boolean } | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [checks, setChecks] = useState<NonNullable<TestboxAdminResult['checks']> | null>(null);
  const [checking, setChecking] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => boxSettingStart());
  const [repos, setRepos] = useState<RepoDraft[]>(() => Array.from({ length: PRIMARY_REPO_ROWS }, blankRepo));
  const [offers, setOffers] = useState<readonly Offer[]>([]);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  // "Show the access line again" opened the connection form on step 2 (an address is recorded that this card no longer holds).
  const [again, setAgain] = useState(false);
  const partial = useRef(false);

  // What this card remembers belongs to the box it was typed for. A Replace or a Disconnect from the connected card (or Start over
  // here) clears the recorded address while this flow is still mounted (a connected box whose parity has not passed keeps it
  // mounted): the access line, the preflight rows and the confirmed settings of the old box must not carry into the new one, and
  // the listen address typed for the old box must not be offered for the new.
  const addressSet = status?.addressSet ?? null;
  const wasSet = useRef(false);
  useEffect(() => {
    if (addressSet === null) return;
    if (wasSet.current && !addressSet) {
      setSeen({}); setConn(BLANK_CONN); setAddressDone(false); setKeyLine(null); setFingerprint(null); setChecks(null); setCopied('no'); setAgain(false);
      setValues((v) => ({ ...v, [TESTBOX_LISTEN_KEY]: '' }));
    }
    wasSet.current = addressSet;
  }, [addressSet]);

  const step = status === null ? 1 : (!status.addressSet && addressDone ? 2 : stepOf(status, seen));
  // A box just disconnected is a card with nothing set up: its last act is not a setup in progress (TC16).
  const started = begun || (status !== null && (status.addressSet || (status.act !== null && status.act.sub !== 'disconnect')));

  // The fleet's own repositories, offered once step 4 is first shown. A failed read offers nothing; the fields stay typeable.
  const offered = useRef(false);
  useEffect(() => {
    if (step !== 4 || offered.current) return undefined;
    offered.current = true;
    let live = true;
    void loadProjects().then((read) => {
      if (!live) return;
      const found = new Map<string, Offer>();
      for (const p of read.projects) {
        if (p.repo?.state !== 'named') continue;
        const slug = p.repo.slug;
        const name = slug.slice(slug.lastIndexOf('/') + 1).toLowerCase();
        if (REPO_NAME.test(name) && !found.has(slug)) found.set(slug, { name, fetchUrl: `${GIT_HOST_BASE}${slug}` });
      }
      setOffers([...found.values()]);
    }, () => undefined);
    return () => { live = false; };
  }, [step]);

  // The listen address starts from the address typed in step 1, once, when step 4 opens with it still blank.
  useEffect(() => {
    if (step !== 4 || conn.address === '') return;
    setValues((v) => ((v[TESTBOX_LISTEN_KEY] ?? '') === '' ? { ...v, [TESTBOX_LISTEN_KEY]: listenFor(conn.address) } : v));
  }, [step, conn.address]);

  /** One act: its answer, or why not. A refusal says its sentence on the card's line; a stale step-up shows the step. */
  const run = async (sub: TestboxAdminSub, fields: TestboxAdminFields): Promise<TestboxAdminResult | null> => {
    line.clear();
    partial.current = false;
    let landed: TestboxAdminResult | 'unreadable' | undefined;
    try {
      const outcome = await stepUp.runAct(async () => { landed = await admin.act(sub, fields); });
      if (outcome === 'step-up') return null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      // A disconnect that cleaned this side and left the box side says so, and the card re-reads: it is not a failure to retry.
      const code = refusalCodeOf(err);
      if (sub === 'disconnect' && code !== null && PARTIAL_DISCONNECT.has(code)) {
        partial.current = true; admin.reload(); onChanged?.(); line.say(codeSentence(code), 'refusal'); return {};
      }
      line.say(testboxRouteText(err) ?? T.unreadable, 'refusal');
      return null;
    }
    if (landed === undefined || landed === 'unreadable') { line.say(T.unknown, 'refusal'); return null; }
    onChanged?.();
    return landed;
  };

  /** Start over: Disconnect, from a connection that is recorded but was never Connected (an abandoned or refused one). It takes the
   *  connection apart as Disconnect does (the switch off, the box's unpair, the token and push key ccrc made, ccrc's access line) and
   *  forgets the address, the host key and the connection here; a pairing made by hand (its keys in `ccrc.env`) is left as it is, and
   *  only the access line and the connection go. `T.startOverWhy` says both. */
  const startOver = async (): Promise<void> => {
    setChecking(true);
    try {
      const r = await run('disconnect', {});
      if (r === null) return;
      // Nothing is recorded now: the card is at step 1, with no "Connect a test box" tap first (as after a Replace).
      setBegun(true);
      if (!partial.current) line.say(T.startedOver);
    } finally { setChecking(false); }
  };

  const makeKey = async (): Promise<void> => {
    const r = await run('key', keyFieldsOf(conn));
    if (r === null) return;
    if (r.line !== undefined) { setKeyLine({ text: r.line, fixed: false }); setSeen((s) => ({ ...s, line: true })); setCopied('no'); setAgain(false); }
  };

  const runPreflight = async (): Promise<void> => {
    const r = await run('preflight', {});
    if (r === null) return;
    setChecks(r.checks ?? []);
    if (r.pass === true) { setSeen((s) => ({ ...s, preflight: true })); return; }
    const mismatch = (r.checks ?? []).some((c) => c.code === FROM_MISMATCH);
    if (mismatch && r.fixLine !== undefined) { setKeyLine({ text: r.fixLine, fixed: true }); setSeen((s) => ({ ...s, line: true })); setCopied('no'); }
  };

  const probe = async (): Promise<void> => {
    setChecking(true);
    try {
      if (status?.hostKey === 'pinned') { await runPreflight(); return; }
      const r = await run('probe', {});
      if (r?.fingerprint !== undefined) setFingerprint(r.fingerprint);
    } finally { setChecking(false); }
  };

  const pin = async (): Promise<void> => {
    if (fingerprint === null) return;
    setChecking(true);
    try {
      const r = await run('pin', { fingerprint });
      if (r === null) return;
      setFingerprint(null);
      await runPreflight();
    } finally { setChecking(false); }
  };

  const install = async (): Promise<void> => {
    const rows = repos.map((d) => rowOf(d, values.CCRC_TESTBOX_ROOT ?? ''));
    const r = await run('connect', { settings: settingsToSend(values), repos: rows });
    if (r === null) return;
    // The install has started: the address typed in step 1 has done its work and is forgotten.
    setConn(BLANK_CONN);
    setSeen((s) => ({ ...s, retry: false }));
  };

  const copy = (text: string): void => {
    try {
      void navigator.clipboard.writeText(text).then(() => setCopied('yes'), () => setCopied('failed'));
    } catch { setCopied('failed'); }
  };

  // -- the states before any step --------------------------------------------------------------------------------
  if (admin.failure?.dark != null) {
    return <div className="testbox-connect" data-testbox="connect" data-band={band}><p className="settings-note" data-testbox="connect-dark" role="status">{T.signInRequired}</p></div>;
  }
  if (status === null) {
    return (
      <div className="testbox-connect" data-testbox="connect" data-band={band}>
        {admin.loading ? <Skeleton lines={2} /> : (
          <>
            <p className={SETTINGS_AMBER_NOTE} role="status">{admin.failure?.text ?? T.unreadable}</p>
            <Button variant="ghost" size={band === 'phone' ? 'full' : 'fit'} onClick={admin.reload}>{T.retryRead}</Button>
          </>
        )}
      </div>
    );
  }
  if (!started) {
    return (
      <div className="testbox-connect" data-testbox="connect" data-band={band}>
        <p className="settings-note" data-testbox="connect-intro">{T.intro}</p>
        <Button variant="primary" size={band === 'phone' ? 'full' : 'fit'} onClick={() => setBegun(true)} data-testbox="connect-begin">{T.begin}</Button>
      </div>
    );
  }

  const actionSize = band === 'phone' ? 'full' : 'fit';
  const busy = admin.busy || checking;
  const act = status.act;
  const connectAct = act !== null && act.sub === 'connect' ? act : null;
  const parityAct = act !== null && act.sub === 'parity' ? act : null;

  const current = ((): ReactNode => {
    switch (step) {
      case 1:
        return <AddressStep conn={conn} setConn={setConn} size={actionSize} onNext={() => { setAddressDone(true); setBegun(true); }} />;
      case 2: {
        // An address already recorded but not in this card's memory (a reload, a refused login, a mistyped address): the
        // connection is typed again here, with the one optional field the line may need (spec §5.1).
        const needsConnection = keyLine === null && again;
        return (
          <div className="testbox-connect-body">
            <StateLine band={band} text={keyLine === null ? (needsConnection ? T.connectionAgainIntro : T.keyIntro) : keyLine.fixed ? T.fixedLine : T.keyWhere}>
              {keyLine === null && !needsConnection && (
                <Button variant="primary" size={actionSize} disabled={busy || !connReady(conn)} onClick={() => void makeKey()} data-testbox="make-key">
                  {admin.busy ? T.makingKey : T.makeKey}
                </Button>
              )}
            </StateLine>
            {needsConnection && (
              <div className="testbox-connect-body" data-testbox="connection-again">
                <ConnFields conn={conn} setConn={setConn} withSource />
                <Button variant="primary" size={actionSize} disabled={busy || !connReady(conn)} onClick={() => void makeKey()} data-testbox="make-key">
                  {admin.busy ? T.makingKey : T.showLineAgain}
                </Button>
              </div>
            )}
            {keyLine !== null && (
              <>
                <p className="settings-note">{T.keyLineLabel}</p>
                <code className="testbox-key-line" data-testbox="key-line">{keyLine.text}</code>
                <div className="testbox-connect-row">
                  <Button variant="ghost" size={actionSize} onClick={() => copy(keyLine.text)} data-testbox="copy-key">{copied === 'yes' ? T.copied : T.copy}</Button>
                  <Button variant="primary" size={actionSize} onClick={() => { setSeen((s) => ({ ...s, line: false, preflight: false })); setChecks(null); }} data-testbox="added">{T.added}</Button>
                </div>
                {copied === 'failed' && <p className={SETTINGS_AMBER_NOTE} role="status">{T.copyFailed}</p>}
              </>
            )}
          </div>
        );
      }
      case 3: {
        const failed = checks !== null && checks.some((c) => !c.ok);
        const pinned = status.hostKey === 'pinned';
        return (
          <div className="testbox-connect-body">
            {fingerprint === null ? (
              <StateLine band={band} text={pinned ? T.preflightLabel : T.probeIntro}>
                <Button variant="primary" size={actionSize} disabled={busy} onClick={() => void probe()} data-testbox="probe">
                  {checking ? T.probing : failed || line.line?.tone === 'refusal' ? T.checkAgain : T.probe}
                </Button>
              </StateLine>
            ) : (
              <>
                <p className="settings-note">{T.fingerprintLabel}</p>
                <code className="testbox-key-line" data-testbox="fingerprint">{fingerprint}</code>
                <p className="settings-note">{T.fingerprintCompare}</p>
                <Button variant="primary" size={actionSize} disabled={busy} onClick={() => void pin()} data-testbox="pin">{checking ? T.pinning : T.confirmFingerprint}</Button>
              </>
            )}
            {checks !== null && (
              <ul className="testbox-checks" data-testbox="checks" aria-label={T.preflightLabel}>
                {checks.map((c) => (
                  <li key={c.check} data-ok={c.ok ? 'true' : 'false'} className={c.ok ? undefined : 'settings-catalogue--amber'}>
                    <span className="testbox-check-name">{checkWord(c.check)}</span>{' '}
                    <span>{c.ok ? T.checkPassed : codeSentence(c.code)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }
      case 4: {
        const root = values.CCRC_TESTBOX_ROOT ?? '';
        const problems = repos.map((d) => repoProblems(d, root));
        const valid = TESTBOX_BOX_KEYS.every((k) => settingProblem(k, values[k] ?? '') === null)
          && repos.length >= 1 && problems.every((p) => Object.keys(p).length === 0);
        return (
          <div className="testbox-connect-body">
            <p className="settings-note">{T.settingsIntro}</p>
            {BOX_SETTING_FAMILIES.map((f) => (
              <details key={f.id} className={TESTBOX_FAMILY_FOLD} data-family={f.id} open={f.id === 'network'}>
                <summary className="settings-note">{f.title}</summary>
                <div className="testbox-form">
                  {f.keys.map((key) => (
                    <Field key={key} label={settingLabel(key)} value={values[key] ?? ''}
                      placeholder={BOX_SETTING_DEFAULTS[key] ?? ''} error={settingProblem(key, values[key] ?? '')}
                      onChange={(v) => setValues((cur) => ({ ...cur, [key]: v }))} />
                  ))}
                </div>
              </details>
            ))}
            <p className="settings-note">{T.repositoriesLabel}</p>
            <p className="settings-note">{T.repositoriesHint}</p>
            {offers.length > 0 && (
              <div className="testbox-offers" data-testbox="offers" aria-label={T.offered}>
                {offers.map((o) => (
                  <Button key={o.fetchUrl} variant="ghost" size={actionSize} onClick={() => setRepos((cur) => {
                    const at = cur.findIndex((d) => d.name === '' && d.fetchUrl === '');
                    const next = { ...blankRepo(), name: o.name, fetchUrl: o.fetchUrl };
                    if (at >= 0) return cur.map((d, i) => (i === at ? { ...d, name: o.name, fetchUrl: o.fetchUrl } : d));
                    return cur.length < TESTBOX_REPO_ROWS_MAX ? [...cur, next] : cur;
                  })}>
                    {o.name}
                  </Button>
                ))}
              </div>
            )}
            {repos.map((d, i) => (
              <fieldset key={i} className="testbox-repo" data-testbox="repo-row">
                <legend className="settings-note">{`${T.repositoriesLabel} ${i + 1}`}</legend>
                <div className="testbox-form">
                  <Field label={T.repoName} value={d.name} error={d.name === '' ? null : problems[i]?.name ?? null}
                    onChange={(v) => setRepos((cur) => cur.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                  <Field label={T.repoUrl} value={d.fetchUrl} error={d.fetchUrl === '' ? null : problems[i]?.fetchUrl ?? null}
                    onChange={(v) => setRepos((cur) => cur.map((x, j) => (j === i ? { ...x, fetchUrl: v } : x)))} />
                  <Field label={T.repoPackage} value={d.pkg} error={d.pkg === '' ? null : problems[i]?.pkg ?? null}
                    onChange={(v) => setRepos((cur) => cur.map((x, j) => (j === i ? { ...x, pkg: v } : x)))} />
                  <Field label={T.repoInputs} value={d.inputs} placeholder={d.pkg === '' ? '' : `${d.pkg}/package.json ${d.pkg}/package-lock.json`} error={null}
                    onChange={(v) => setRepos((cur) => cur.map((x, j) => (j === i ? { ...x, inputs: v } : x)))} />
                  <Field label={T.repoCommand} value={d.command} error={d.command === '' ? null : problems[i]?.command ?? null}
                    onChange={(v) => setRepos((cur) => cur.map((x, j) => (j === i ? { ...x, command: v } : x)))} />
                </div>
                {problems[i]?.row !== undefined && <p className={SETTINGS_AMBER_NOTE}>{problems[i]?.row}</p>}
                {repos.length > 1 && (
                  <Button variant="ghost" size={actionSize} onClick={() => setRepos((cur) => cur.filter((_, j) => j !== i))}>{T.removeRepo}</Button>
                )}
              </fieldset>
            ))}
            {repos.length < TESTBOX_REPO_ROWS_MAX && (
              <Button variant="ghost" size={actionSize} onClick={() => setRepos((cur) => [...cur, blankRepo()])}>{T.addRepo}</Button>
            )}
            {repos.length === 0 && <p className={SETTINGS_AMBER_NOTE}>{T.needRepo}</p>}
            <Button variant="primary" size={actionSize} disabled={!valid} onClick={() => setSeen((s) => ({ ...s, settings: true }))} data-testbox="settings-next">{T.next}</Button>
          </div>
        );
      }
      case 5: {
        const running = connectAct?.outcome === 'running';
        const failedAct = connectAct?.outcome === 'failed' ? connectAct : null;
        const held = seen.settings === true;
        return (
          <div className="testbox-connect-body">
            <StateLine band={band} text={failedAct !== null ? T.actFailed(failedAct.phase === null ? T.failedAt : phaseWord(failedAct.phase), codeSentence(failedAct.code)) : T.installIntro}>
              {!running && failedAct === null && (
                <Button variant="primary" size={actionSize} disabled={busy || !held} onClick={() => void install()} data-testbox="install">{busy ? T.installing : T.install}</Button>
              )}
              {failedAct !== null && (
                <Button variant="primary" size={actionSize} disabled={busy} onClick={() => (held ? void install() : setSeen((s) => ({ ...s, retry: true })))} data-testbox="try-again">{T.tryAgain}</Button>
              )}
            </StateLine>
            {connectAct !== null && <Phases sub="connect" act={connectAct} />}
          </div>
        );
      }
      default: {
        const word = parityWord(status);
        const running = parityAct?.outcome === 'running';
        const failedAct = parityAct?.outcome === 'failed' ? parityAct : null;
        const record = status.parity;
        const text = running ? T.parityRunning
          : failedAct !== null ? codeSentence(failedAct.code)
            : word === 'pass' ? T.parityPassed : word === 'fail' ? T.parityFailed : word === 'stale' ? T.parityStale : T.parityIntro;
        return (
          <div className="testbox-connect-body">
            <p className="testbox-connected" data-testbox="connected">{T.connected}</p>
            <StateLine band={band} text={text}>
              {!running && word !== 'pass' && (
                <Button variant="primary" size={actionSize} disabled={busy} onClick={() => void run('parity', {})} data-testbox="run-parity">
                  {failedAct !== null || word === 'fail' ? T.tryAgain : T.runParity}
                </Button>
              )}
            </StateLine>
            {parityAct !== null && <Phases sub="parity" act={parityAct} />}
            {record !== null && !running && (
              <ul className="testbox-checks" data-testbox="parity-record">
                <li>{T.parityPrs(record.prs.length)}</li>
                {record.fixtures.map((x) => <li key={x.name}>{T.fixtureWord(x.name, x.result)}</li>)}
              </ul>
            )}
          </div>
        );
      }
    }
  })();

  // A connection that is recorded and was never Connected can be taken back to the line or to step 1 from here, so an abandoned or
  // refused one never needs a shell (spec C6, the acceptance of "the card alone"). While its install runs, nothing is offered.
  const recovery = status.addressSet && !status.connected && connectAct?.outcome !== 'running' ? (
    <div className="testbox-connect-recovery" data-testbox="recovery">
      <div className="testbox-connect-row">
        {step !== 2 && (
          <Button variant="ghost" size={actionSize} disabled={busy}
            onClick={() => { setKeyLine(null); setChecks(null); setAgain(true); setSeen((s) => ({ ...s, line: true })); }} data-testbox="show-line-again">{T.showLineAgain}</Button>
        )}
        <Button variant="ghost" size={actionSize} disabled={busy} onClick={() => void startOver()} data-testbox="start-over">{checking ? T.startingOver : T.startOver}</Button>
      </div>
      <p className="settings-note" data-testbox="start-over-why">{T.startOverWhy}</p>
    </div>
  ) : null;

  const recent = band === 'wide' ? <Ledger events={admin.events} /> : null;
  return (
    <div className="testbox-connect" data-testbox="connect" data-band={band}>
      <div className="testbox-connect-grid">
        <ol className="testbox-steps" aria-label={T.stepsLabel} data-testbox="steps">
          {T.stepNames.map((name, i) => {
            const n = i + 1;
            const state = n < step ? 'done' : n === step ? 'current' : 'todo';
            return (
              <li key={name} data-step={n} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                <span className="testbox-step-name">{name}{state === 'done' && <span className="settings-note">{` (${T.done})`}</span>}</span>
                {band === 'phone' && state === 'current' && <div className="testbox-step-open" data-testbox="step-open">{current}{recovery}</div>}
              </li>
            );
          })}
        </ol>
        {band !== 'phone' && <div className="testbox-step-panel" data-testbox="step-panel">{current}{recovery}</div>}
        {recent}
      </div>
      <ConfirmItsYou stepUp={stepUp} subject="the test box" />
      <ResultLine line={line.line} />
    </div>
  );
}

/** A state sentence with the act's button at its end (laptop and wide), or under it (phone). */
export function StateLine({ band, text, children }: { band: Band; text: string; children?: ReactNode }): ReactNode {
  return (
    <div className="testbox-connect-stateline" data-testbox="connect-state" data-band={band}>
      <p className="settings-note testbox-connect-text">{text}</p>
      {children}
    </div>
  );
}

export function Field({ label, value, onChange, error, placeholder, now, disabled, footnote, setting, action }: {
  label: string; value: string; onChange: (v: string) => void; error: string | null; placeholder?: string;
  /** A control of the row's own under its input (the connected card's Reset to default, D-8336). */
  action?: ReactNode;
  /** What the setting reads now, beside its name (the connected card's settings). */
  now?: string;
  disabled?: boolean;
  /** One note under a disabled field (why it cannot be edited). */
  footnote?: string | null;
  /** The setting's key, for the connected card's rows. */
  setting?: string;
}): ReactNode {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className="testbox-field" data-setting={setting}>
      <label htmlFor={id} className="settings-note">{label}</label>
      {now !== undefined && <span className="settings-note testbox-setting-now" data-testbox="setting-now">{now}</span>}
      <TextInput id={id} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} disabled={disabled}
        aria-invalid={error === null ? undefined : true} aria-describedby={error === null ? undefined : errId}
        onChange={(e) => onChange(e.target.value)} />
      {action}
      {footnote !== undefined && footnote !== null && <p className="settings-note" data-testbox="ccrc-env-note">{footnote}</p>}
      {error !== null && <p id={errId} className={SETTINGS_AMBER_NOTE} role="status">{error}</p>}
    </div>
  );
}

/** The connection's fields: the address, the port, the login and, where the box may have refused the key, the address it sees. */
export function ConnFields({ conn, setConn, withSource = false }: { conn: Conn; setConn: (c: Conn) => void; withSource?: boolean }): ReactNode {
  const address = conn.address.trim();
  const addressOk = isBoxAddress(address);
  const publicAddress = addressOk && isPublicIpLiteral(address);
  const portOk = isSshPort(conn.port.trim());
  const loginOk = isLoginUser(conn.login.trim());
  const source = conn.source.trim();
  return (
    <div className="testbox-form">
      <Field label={T.addressLabel} value={conn.address} error={conn.address === '' || (addressOk && !publicAddress) ? null : publicAddress ? T.badPublicAddress : T.badAddress}
        onChange={(v) => setConn({ ...conn, address: v })} />
      <Field label={T.portLabel} value={conn.port} error={conn.port === '' || portOk ? null : T.badPort}
        onChange={(v) => setConn({ ...conn, port: v })} />
      <Field label={T.loginLabel} value={conn.login} error={conn.login === '' || loginOk ? null : T.badLogin}
        onChange={(v) => setConn({ ...conn, login: v })} />
      {withSource && (
        <>
          <Field label={T.sourceLabel} value={conn.source} error={source === '' || isIpLiteral(source) ? null : T.badAddress}
            onChange={(v) => setConn({ ...conn, source: v })} />
          <p className="settings-note">{T.sourceHint}</p>
        </>
      )}
    </div>
  );
}

function AddressStep({ conn, setConn, size, onNext }: {
  conn: Conn; setConn: (c: Conn) => void; size: 'full' | 'fit'; onNext: () => void;
}): ReactNode {
  const ready = connReady({ ...conn, source: '' });
  const next = (): void => { setConn({ ...conn, address: conn.address.trim(), port: conn.port.trim(), login: conn.login.trim() }); onNext(); };
  return (
    <div className="testbox-connect-body" data-testbox="address-step">
      <ConnFields conn={conn} setConn={setConn} />
      <p className="settings-note">{T.addressHint}</p>
      <Button variant="primary" size={size} disabled={!ready} onClick={next} data-testbox="address-next">{T.next}</Button>
    </div>
  );
}

/** A long act's phases, each with its time once done, `running` while it runs and the failing one marked. */
export function Phases({ sub, act }: { sub: TestboxPhasedSub; act: NonNullable<TestboxAdminStatus['act']> }): ReactNode {
  const order = TESTBOX_ADMIN_PHASES[sub];
  const done = new Map(act.phases.map((p) => [p.name, p.ms]));
  return (
    <ol className="testbox-phases" data-testbox="phases" aria-label={T.phasesLabel}>
      {order.map((p) => {
        const ms = done.get(p);
        const state = ms !== undefined ? 'done' : act.phase === p ? (act.outcome === 'failed' ? 'failed' : 'running') : 'waiting';
        return (
          <li key={p} data-phase={p} data-state={state} className={state === 'failed' ? 'settings-catalogue--amber' : undefined}>
            <span>{phaseWord(p)}</span>{' '}
            <span className="settings-note">{ms !== undefined ? phaseTime(ms) : state === 'running' ? T.running : state === 'failed' ? T.failedAt : T.waiting}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The ledger's recent acts, beside the steps at the widest band. */
function Ledger({ events }: { events: readonly TestboxEventRow[] }): ReactNode {
  const shown = useMemo(() => events.slice(0, 5), [events]);
  return (
    <aside className="testbox-ledger" data-testbox="ledger" aria-label={T.recent}>
      <p className="settings-note">{T.recent}</p>
      {shown.length === 0 ? <p className="settings-note">{T.noActs}</p> : (
        <ul className="testbox-checks">
          {shown.map((e) => (
            <li key={e.id}>{`${utcMinute(e.at)} ${actWord(e.act)} ${e.outcome}`}{e.code !== null && <span className="settings-note">{` ${codeSentence(e.code)}`}</span>}</li>
          ))}
        </ul>
      )}
    </aside>
  );
}
