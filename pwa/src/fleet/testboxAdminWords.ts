// D-8166 (test box connect plan TC15; spec 2026-11-07-test-box-connect-design.md §2.2, §5.1): the words of the card's
// "Connect a test box" flow, and the three pure decisions it draws from. L1: no fetch, no store, no component.
//
//   * `TESTBOX_CONNECT_TEXT`: every sentence the six steps say, in one table, so no component spells a second copy.
//   * `codeSentence(code)`: a closed code in one line that names no value. The sentences are `shared/testbox-admin.ts`'s
//     own (`TESTBOX_ADMIN_CODE_SENTENCE`), so the card, the route's refusals and the verb's contract say one thing.
//   * `phaseWord(phase)`: a phase of a long act in the operator's words.
//   * `stepOf(status, seen)`: which of the six steps is current. Read from the status the verb wrote, so a reload shows the
//     same step; `seen` holds only what the status cannot say (the access line was shown here, the preflight passed here, the
//     settings were confirmed here), and a card that was reloaded has none of it, which only ever moves a step back.
//   * `BOX_SETTING_FAMILIES` and `BOX_SETTING_DEFAULTS`: the box's 28 settings in the four folded families of step 4 and the
//     defaults the form starts from; `pwa/test/testbox-admin-words.test.ts` holds the defaults to `ccd/testbox-knobs`.
import {
  TESTBOX_ACT_MAP, TESTBOX_ADMIN_CODE_SENTENCE, TESTBOX_BOX_KEYS, TESTBOX_FLEET_EDITABLE, TESTBOX_PAIRED_BOX_KEYS, TESTBOX_SHAPE_CLASS,
  TESTBOX_SHAPE_SENTENCE, isBoxAddress, isPrivateNetworkAddress,
  type TestboxAct, type TestboxAdminCode, type TestboxAdminPhase, type TestboxAdminStatus, type TestboxAdminSub,
} from '../../../shared/testbox-admin';
import { TESTBOX_PARITY_REQUIRED_SENTENCE, type BoxSettingRow, type NodeWire } from '../../../shared/api';
import type { TestboxEventRow } from '../../../shared/api';
import { boxSettingsOf } from './boxSettingsWords';

/** The preflight's one code that carries a corrected access line (`fixLine`), spelled once. */
export const FROM_MISMATCH: TestboxAdminCode = 'from-mismatch';

/** The sentence for a code this build does not know (a newer verb): the act failed, and the ledger has the rest. */
const UNKNOWN_CODE_SENTENCE = 'The test box act failed for a reason this version of ccrc does not name.';

export const TESTBOX_CONNECT_TEXT = {
  heading: 'Connect a test box',
  intro: 'A test box is a second computer that runs your tests, so the fleet host stays free. ccrc sets it up over ssh and needs one login on it.',
  begin: 'Connect a test box',
  stepNames: ['The address', 'Give ccrc access', 'Check the box', 'The box settings', 'Install and pair', 'Parity'],
  stepsLabel: 'Connecting a test box',
  stepOf: (n: number, of: number) => `Step ${n} of ${of}`,
  done: 'done',
  signInRequired: 'Sign-in is required to connect a test box. Turn it on for this console, then come back here.',
  loading: 'Reading the test box state',
  unreadable: 'The test box state could not be read just now.',
  retryRead: 'Read it again',
  // step 1
  addressLabel: 'Address',
  addressHint: 'An IP address or a host name. Nothing is sent to the box yet.',
  portLabel: 'SSH port',
  loginLabel: 'Login user',
  loginHint: 'root, or a user with passwordless sudo.',
  badAddress: 'That is not an IP address or a host name. Leave out the port and the user.',
  badPublicAddress: 'That address is not on a private network. The test service has no encryption of its own, so use the box\'s address on a tailnet, a VPN or your provider\'s private network.',
  badPort: 'The port is a whole number from 1 to 65535.',
  badLogin: 'A login user is lower-case letters, digits, _ and -.',
  next: 'Continue',
  // step 2
  keyIntro: 'ccrc makes its own key pair on the fleet host and keeps the private half there.',
  makeKey: 'Generate access key',
  makingKey: 'Making the key…',
  keyWhere: "Add this line to the login user's authorized_keys on the box.",
  // coming back to the line, or to the connection, once an address is recorded (a reload, a refused login, a mistyped address)
  showLineAgain: 'Show the access line again',
  changeConnection: 'Change the address, the port or the login',
  connectionAgainIntro: 'Type the connection again: the card never keeps the address. The access key itself is unchanged.',
  sourceLabel: 'Address the box sees ccrc connect from (only if the box refused the key)',
  sourceHint: 'A box behind a NAT or on a second network sees another address than this host uses. Its ssh log names it. Leave blank otherwise.',
  startOver: 'Start over',
  startingOver: 'Starting over…',
  startOverWhy: 'Start over takes this connection apart: it turns the switch off, stops the test service on the box and removes the token and push key ccrc made, takes ccrc\'s access line off the box (when ccrc can reach it), and forgets the address, the host key and the connection here. The access key is kept. A pairing you made by hand, with its keys in the settings file, is not touched: only ccrc\'s access line and the connection here go.',
  startedOver: 'Started over.',
  keyLineLabel: 'Public access line',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Could not copy. Select the line and copy it by hand.',
  added: 'I have added it',
  fixedLine: 'The box sees ccrc connect from a different address than the line allowed. Replace the line you added with this one.',
  // step 3
  probeIntro: 'ccrc connects once and shows the host key the box presents.',
  probe: 'Check the box',
  probing: 'Checking the box…',
  fingerprintLabel: 'Host key fingerprint',
  fingerprintCompare: "Compare it with the fingerprint your provider's console shows.",
  confirmFingerprint: 'Confirm',
  pinning: 'Confirming…',
  preflightLabel: 'Prerequisites',
  checkPassed: 'passed',
  checkAgain: 'Check again',
  preflightPassed: 'Every prerequisite passed.',
  // step 4
  settingsIntro: 'Each value is checked as you type. A blank value keeps its default.',
  repositoriesLabel: 'Repositories to run',
  repositoriesHint: 'One to four. The box keeps a copy of each and runs its tests there.',
  repoName: 'Name',
  repoUrl: 'Fetch URL',
  repoPackage: 'Package folder',
  repoInputs: 'Install inputs',
  repoCommand: 'Test runner',
  addRepo: 'Add a repository',
  removeRepo: 'Remove',
  offered: 'From the fleet',
  badValue: (shape: string) => `Not ${shape}.`,
  badRepoName: 'A name is letters, digits, . _ and -.',
  badRepoUrl: 'An https or ssh URL such as https://git.invalid/team/project.',
  badRepoWord: 'Required.',
  badRepoRow: 'That row is not one the box can take. Check the install inputs.',
  needListen: 'The address the service listens on is required: the box\'s private address, the one ccrc reaches it on.',
  listenNotPrivate: 'The service listens on the box\'s private address, an IP address on a tailnet, a VPN or your provider\'s private network, the one ccrc reaches it on.',
  needRepo: 'Add at least one repository.',
  // step 5
  installIntro: 'Install copies the release to the box, writes its settings, installs the service and pairs it with this console.',
  install: 'Install',
  installing: 'Installing…',
  phasesLabel: 'Install phases',
  running: 'running',
  waiting: 'waiting',
  failedAt: 'failed',
  connected: 'Connected',
  tryAgain: 'Try again',
  // step 6
  parityIntro: 'Parity runs recent pull requests on the test box and on the fleet host and compares them. The switch turns on only after it passes.',
  runParity: 'Run parity',
  parityRunning: 'Running parity…',
  parityPassed: 'Parity passed.',
  parityFailed: 'Parity failed.',
  parityStale: 'Parity must run again: the box or its settings changed since it last passed.',
  parityNone: 'Parity has not run yet.',
  parityPrs: (n: number) => (n === 1 ? '1 pull request compared' : `${n} pull requests compared`),
  fixtureWord: (name: string, result: string) => `${name}: ${result}`,
  // the switch, beside the card's own
  switchWaits: TESTBOX_PARITY_REQUIRED_SENTENCE,
  // the ledger
  recent: 'Recent acts',
  noActs: 'No acts yet.',
  // the last act's one line
  actFailed: (phase: string, sentence: string) => `${phase} failed. ${sentence}`,
  unknown: 'The server did not answer in time, so it is not known whether that went through. The card re-reads the state.',
} as const;

/** One closed code in one line that names no value; a code this build does not know says so. */
export function codeSentence(code: string | null): string {
  return code !== null && Object.hasOwn(TESTBOX_ADMIN_CODE_SENTENCE, code)
    ? TESTBOX_ADMIN_CODE_SENTENCE[code as keyof typeof TESTBOX_ADMIN_CODE_SENTENCE]
    : UNKNOWN_CODE_SENTENCE;
}

const PHASE_WORD: Readonly<Record<TestboxAdminPhase, string>> = {
  verify: 'Verify the release',
  copy: 'Copy it to the box',
  settings: 'Write the settings',
  install: 'Install the service',
  pair: 'Pair',
  check: 'Check the box answers',
  wait: 'Wait until the box is idle',
  legs: 'Run the pull requests and checks',
  record: 'Record the result',
};

/** A phase of a long act in the operator's words; a phase this build does not know is its own name. */
export function phaseWord(phase: string): string {
  return Object.hasOwn(PHASE_WORD, phase) ? PHASE_WORD[phase as TestboxAdminPhase] : phase;
}

/** A check the preflight ran, in words: `no-egress` is not a check name; the check names are the verb's (`os`, `systemd`). */
export function checkWord(check: string): string {
  const text = check.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A phase's time: `0.4 s`, `12 s`, `2 min 5 s`. */
export function phaseTime(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** What only the card in front of the operator knows, each of which only ever moves a step back after a reload. */
export interface TestboxStepSeen {
  /** The access line is on screen and "I have added it" has not been pressed. */
  readonly line?: boolean;
  /** The preflight passed in this card. */
  readonly preflight?: boolean;
  /** The settings and repositories were confirmed in this card. */
  readonly settings?: boolean;
  /** "Try again" was pressed on a failed install: back to the settings. */
  readonly retry?: boolean;
}

/** Which of the six steps is current. 1: nothing recorded. 2: the access line is showing. 3: a connection is recorded and
 *  the host key is not pinned or the preflight has not passed. 4: pinned and the preflight passed. 5: an install is
 *  running or failed (or the settings were confirmed). 6: connected. */
export function stepOf(status: TestboxAdminStatus | null, seen: TestboxStepSeen = {}): 1 | 2 | 3 | 4 | 5 | 6 {
  if (status === null || !status.addressSet) return 1;
  if (status.connected) return 6;
  const act = status.act !== null && status.act.sub === 'connect' ? status.act : null;
  if (act !== null && act.outcome === 'running') return 5;
  // A connect that failed after the host key was pinned: the failing phase and Try again, read from the status.
  if (act !== null && act.outcome === 'failed' && status.hostKey === 'pinned' && seen.retry !== true) return 5;
  if (seen.line === true) return 2;
  if (status.hostKey !== 'pinned' || seen.preflight !== true) return 3;
  return seen.settings === true ? 5 : 4;
}

// ---------------------------------------------------------------------------------------------------------------
// Step 4's settings.
// ---------------------------------------------------------------------------------------------------------------

export type BoxSettingFamily = 'runs' | 'storage' | 'network' | 'accounts' | 'probes';

/** The folded families, in the order the form draws them. Every one of the 31 box keys is in exactly one (D-8290 adds the live
 *  probes' family: the scratch account's config directory, its tmux socket and the day's budget, which the harness programme sets). */
export const BOX_SETTING_FAMILIES: readonly { readonly id: BoxSettingFamily; readonly title: string; readonly keys: readonly string[] }[] = Object.freeze([
  {
    id: 'runs', title: 'Runs',
    keys: Object.freeze(['CCRC_TESTBOX_RUNS', 'CCRC_TESTBOX_WORKERS', 'CCRC_TESTBOX_RUN_TMPDIR', 'CCRC_TESTBOX_RUN_MEMORY_MAX',
      'CCRC_TESTBOX_RUN_SWAP_MAX', 'CCRC_TESTBOX_RUN_CPU_QUOTA', 'CCRC_TESTBOX_TMPFS', 'CCRC_TESTBOX_SESSION_RUNS', 'CCRC_TESTBOX_UNIT_MAX']),
  },
  {
    id: 'storage', title: 'Storage',
    keys: Object.freeze(['CCRC_TESTBOX_ROOT', 'CCRC_TESTBOX_REPOS', 'CCRC_TESTBOX_TOOLS_DIR', 'CCRC_TESTBOX_FETCH_EVERY', 'CCRC_TESTBOX_RETENTION',
      'CCRC_TESTBOX_PRISTINE_KEEP', 'CCRC_TESTBOX_PRISTINE_RETRY', 'CCRC_TESTBOX_REPORT_MAX', 'CCRC_TESTBOX_LOG_TAIL']),
  },
  {
    id: 'network', title: 'Network',
    keys: Object.freeze(['CCRC_TESTBOX_LISTEN', 'CCRC_TESTBOX_OS_MIRROR', 'CCRC_TESTBOX_EGRESS_ALLOW', 'CCRC_TESTBOX_REGISTRY_PROXY',
      'CCRC_TESTBOX_REGISTRY_UPSTREAM']),
  },
  {
    id: 'accounts', title: 'Users and files',
    keys: Object.freeze(['CCRC_TESTBOX_PUSH_USER', 'CCRC_TESTBOX_ENV_FORWARD', 'CCRC_TESTBOX_RUN_USER_PREFIX', 'CCRC_TESTBOX_SERVICE_USER',
      'CCRC_TESTBOX_SERVICE_TOKEN_FILE']),
  },
  {
    id: 'probes', title: 'Live probes',
    keys: Object.freeze(['CCRC_TESTBOX_PROBE_CONFIG_DIR', 'CCRC_TESTBOX_PROBE_SOCKET', 'CCRC_TESTBOX_PROBES_PER_DAY']),
  },
]);

/** The key the address fills (`host:port`, the port the service listens on). */
export const TESTBOX_LISTEN_KEY = 'CCRC_TESTBOX_LISTEN';
/** The service port the form offers with the address (`CCRC_TESTBOX_LISTEN`'s port). It is a starting value the operator
 *  edits; no other part of ccrc reads it. */
export const TESTBOX_SERVICE_PORT = 8740;

const IPV4_LITERAL = /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/;

/** `CCRC_TESTBOX_LISTEN` for an address: `host:port` for a private IPv4 literal, `[host]:port` for a private IPv6 one, and blank for
 *  anything else. A host name is blank because the installer refuses one there (the firewall takes addresses), so the operator fills
 *  it. A public address is blank because Connect refuses it (the service has no TLS and the box must be on a private network, spec
 *  C4, M21): the card never fills a setting that would carry the token across the internet. */
export function listenFor(address: string, port: number = TESTBOX_SERVICE_PORT): string {
  if (!isPrivateNetworkAddress(address)) return '';
  if (IPV4_LITERAL.test(address)) return `${address}:${port}`;
  return `[${address}]:${port}`;
}

/** The host of a `host:port` listen value (brackets dropped), or null when it has no port. */
export function listenHostOf(value: string): string | null {
  const at = value.lastIndexOf(':');
  if (at < 1) return null;
  const host = value.slice(0, at);
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** Whether a typed address is an IP literal that is not on a private network (a host name is not judged here: the verb resolves
 *  it and refuses a public answer). The card says so at step 1, and Connect refuses it anyway. */
export function isPublicIpLiteral(address: string): boolean {
  const literal = IPV4_LITERAL.test(address) || (address.includes(':') && isBoxAddress(address));
  return literal && !isPrivateNetworkAddress(address);
}

/** Whether a typed address is an IP literal (the `source` field takes no host name). */
export function isIpLiteral(address: string): boolean {
  return IPV4_LITERAL.test(address) || (address.includes(':') && isBoxAddress(address));
}

/** The form's starting value of each box key: `_tb_box_table`'s default (held equal by the words test), except the two the
 *  installer refuses in the table's `~/` form (the root has no home to resolve it against), which start as absolute paths,
 *  and the listen address, which the address fills. A blank default is a setting the box leaves unset. */
export const BOX_SETTING_DEFAULTS: Readonly<Record<string, string>> = Object.freeze({
  CCRC_TESTBOX_RUNS: '2', CCRC_TESTBOX_WORKERS: '2', CCRC_TESTBOX_RUN_TMPDIR: '/tmp/r', CCRC_TESTBOX_RUN_MEMORY_MAX: '4G',
  CCRC_TESTBOX_RUN_SWAP_MAX: '1G', CCRC_TESTBOX_RUN_CPU_QUOTA: '200%', CCRC_TESTBOX_ROOT: '~/.ccrc/testbox',
  CCRC_TESTBOX_REPOS: '~/.ccrc/testbox-repos.d', CCRC_TESTBOX_FETCH_EVERY: '5m', CCRC_TESTBOX_RETENTION: '24h',
  CCRC_TESTBOX_PRISTINE_KEEP: '7d', CCRC_TESTBOX_PRISTINE_RETRY: '2m 10m 1h 1d', CCRC_TESTBOX_REPORT_MAX: '16M',
  CCRC_TESTBOX_TOOLS_DIR: '/opt/ccrc-testbox/tools', CCRC_TESTBOX_OS_MIRROR: '',
  CCRC_TESTBOX_EGRESS_ALLOW: 'github.com nodejs.org storage.googleapis.com', CCRC_TESTBOX_PUSH_USER: 'ccrc-tb-push',
  CCRC_TESTBOX_ENV_FORWARD: 'CCRC_HISTORY_BASE CCRC_LEDGER_BASE', CCRC_TESTBOX_RUN_USER_PREFIX: 'ccrc-tb-',
  CCRC_TESTBOX_REGISTRY_PROXY: '127.0.0.2:4873', CCRC_TESTBOX_REGISTRY_UPSTREAM: 'https://registry.npmjs.org',
  CCRC_TESTBOX_TMPFS: 'off', CCRC_TESTBOX_LOG_TAIL: '40', CCRC_TESTBOX_SESSION_RUNS: '1', CCRC_TESTBOX_SERVICE_USER: 'ccrc-tb-svc',
  CCRC_TESTBOX_LISTEN: '', CCRC_TESTBOX_SERVICE_TOKEN_FILE: '~/.ccrc/testbox-service.token', CCRC_TESTBOX_UNIT_MAX: '1h',
  CCRC_TESTBOX_PROBE_CONFIG_DIR: '', CCRC_TESTBOX_PROBE_SOCKET: 'ccrc-probe', CCRC_TESTBOX_PROBES_PER_DAY: '10',
});

/** The two paths the installer refuses with `~/` (root has no reader's home), and the absolute paths the form starts them from. */
export const BOX_SETTING_FORM_START: Readonly<Record<string, string>> = Object.freeze({
  CCRC_TESTBOX_ROOT: '/var/lib/ccrc-testbox',
  CCRC_TESTBOX_REPOS: '/etc/ccrc-testbox/repos.d',
});

/** The form's start: every box key, each at its default, the two paths absolute. */
export function boxSettingStart(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of TESTBOX_BOX_KEYS) out[key] = BOX_SETTING_FORM_START[key] ?? BOX_SETTING_DEFAULTS[key] ?? '';
  return out;
}

/** The sentence a value off its key's shape is refused with, in the shape's words. */
export function shapeSentence(key: string): string {
  const cls = Object.hasOwn(TESTBOX_SHAPE_CLASS, key) ? TESTBOX_SHAPE_CLASS[key]! : null;
  return TESTBOX_CONNECT_TEXT.badValue(cls === null ? 'a value this key takes' : TESTBOX_SHAPE_SENTENCE[cls]);
}

/** A key as a label: `CCRC_TESTBOX_RUN_MEMORY_MAX` is the setting's own name, shown as it is written in the settings file. */
export const settingLabel = (key: string): string => key;

const ACT_WORD: Readonly<Record<TestboxAct, string>> = {
  'connect': 'Connect', 'confirm-host-key': 'Confirm host key', 'install': 'Install', 'pair': 'Pair',
  'settings-fleet': 'Fleet settings', 'settings-box': 'Box settings', 'parity': 'Parity', 'switch': 'Switch',
  'repair': 'Repair', 'replace': 'Replace', 'disconnect': 'Disconnect', 'apply-release': 'Apply release', 'cancel': 'Cancel',
};

/** A ledger act in words; an act this build does not know is its own name. */
export function actWord(act: string): string {
  return Object.hasOwn(TESTBOX_ACT_MAP, act) ? ACT_WORD[act as TestboxAct] : act;
}

/** The runner a repository row starts with. The parity tool appends `run`, `--reporter=junit` and `--maxWorkers=N` to a row's command
 *  head, and the box matches runs by that head (every row in the tree uses it), so a package manager's `npm test` would hand vitest
 *  none of the flags: no JUnit report is written, every pull request leg reads DIFFERS and the switch never arms. */
export const TESTBOX_DEFAULT_RUNNER = './node_modules/.bin/vitest';

/** The fleet's repository, as the card offers it: GitHub's https form of a slug `_gh_repo_slug` measured (`owner/name`). */
export const GIT_HOST_BASE = 'https://github.com/';

// ---------------------------------------------------------------------------------------------------------------
// The connected card (D-8166, TC16; spec §2.2 "Connected" and "Blocked", §2.6, §2.7, §2.9, §2.10).
// ---------------------------------------------------------------------------------------------------------------

/** The class of a folded family of settings, in the connect flow and the connected card alike. */
export const TESTBOX_FAMILY_FOLD = 'settings-release-fold testbox-family';

/** A ledger time to the minute, UTC. */
export const utcMinuteAt = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** One ledger row as one line: its minute, the act in words, its outcome, and a closed code's sentence. No address, no secret:
 *  a row carries none (spec §2.10). */
export function ledgerLine(e: TestboxEventRow): string {
  return `${utcMinuteAt(e.at)} ${actWord(e.act)} ${e.outcome}${e.code === null ? '' : ` ${codeSentence(e.code)}`}`;
}

export const TESTBOX_MANAGE_TEXT = {
  stateLabel: 'Connection',
  addressLabel: 'Address',
  addressSet: 'set',
  hostKeyLabel: 'Pinned host key',
  hostKeyNone: 'not pinned',
  hostKeyChanged: 'changed, not confirmed',
  lastAct: 'Last act',
  noActs: 'No acts yet.',
  recent: 'Recent acts',
  settings: 'Settings',
  settingsClose: 'Close settings',
  repair: 'Repair',
  repairing: 'Repairing…',
  replace: 'Replace',
  disconnect: 'Disconnect',
  applyRelease: 'Apply release to box',
  applyingRelease: 'Applying…',
  applyReleaseWhy: 'The box runs a different release than this fleet host. Applying it re-runs the installer from the release the box already holds.',
  // blocked lines, one control each
  blockedHostKey: 'The box presented a different host key than the one ccrc pinned, so every act is held. Confirm the new fingerprint, or disconnect.',
  showNewFingerprint: 'Show the new fingerprint',
  newFingerprintLabel: 'Host key fingerprint the box presents now',
  confirmNewFingerprint: 'Confirm',
  blockedAccess: 'ccrc can no longer log in to the box with its access key.',
  showAccessLine: 'Show the access line',
  accessWhere: "Add this line to the login user's authorized_keys on the box, then check it.",
  accessIntro: 'Type the box address again: the card never keeps it. The key itself is unchanged.',
  accessChecked: 'ccrc can log in to the box again.',
  checkAccess: 'Check it',
  blockedFailed: (what: string, sentence: string) => `${what} failed. ${sentence}`,
  tryAgain: 'Try again',
  // settings
  settingsIntro: 'Only the values you change are sent. A value that is only shown as set keeps its setting until you type a new one.',
  boxHead: 'On the box',
  fleetHead: 'On this fleet host',
  keepSet: 'Leave blank to keep',
  shownSet: 'set',
  shownNotSet: 'not set',
  shownRefused: 'refused by its check',
  shownUnmeasured: 'not measured',
  shownDefault: 'default',
  fleetNone: 'The fleet host has not reported its settings yet.',
  boxNone: 'The box has not reported its settings yet.',
  setInCcrcEnv: 'Set in ccrc.env',
  pairingHead: 'Pairing',
  pairingNote: 'Made by Connect, Replace and Disconnect only.',
  pairingSet: 'set',
  pairingNotSet: 'not set',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved. The values shown are what the fleet host and the box read back.',
  nothingChanged: 'Nothing has changed.',
  parityAgain: 'A run-shaping change means parity must run again before the switch turns on.',
  runsNote: 'Runs are in progress on the box. A change to the box waits until none is.',
  applyWhenIdle: 'Apply when idle',
  waiting: 'Waiting until the box is idle.',
  cancel: 'Cancel',
  cancelled: 'Cancelled.',
  cancelTooLate: 'Too late to cancel. The change is already being applied to the box.',
  // Reset to default (D-8336): one tap on the row, then the confirm sheet
  resetToDefault: 'Reset to default',
  resetTitle: 'Reset to default',
  resetWhat: (label: string) => `${label} goes back to its default.`,
  resetFleet: 'ccrc takes it out of the test box settings file it wrote on this fleet host, so the fleet host reads the default from then on.',
  resetBox: "ccrc takes it out of the box's settings file and applies the box's settings again, so the box reads the default from then on.",
  resetDone: 'Reset. The value shown is what the fleet host reads back.',
  // the sheet
  replaceTitle: 'Replace the test box',
  disconnectTitle: 'Disconnect the test box',
  confirmReplace: 'Replace',
  confirmDisconnect: 'Disconnect',
  removedHead: 'This removes',
  removedBox: 'On the box: the test service is stopped and disabled, and the push key line, the service token and the line ccrc added to authorized_keys are removed.',
  removedFleet: 'On the fleet host: the token, the push key, the settings file ccrc wrote, the host key pin and the parity record are removed.',
  keptHead: 'This keeps',
  kept: "ccrc's own access key, so the next Connect shows the same line. Nothing on the box's disk is wiped.",
  switchOff: 'The switch is turned off first. Runs in progress finish, or fall back to this host.',
  rebuild: 'Rebuild the box rather than reuse it.',
  replaceThen: 'Then you connect the new box, and parity must pass again.',
  disconnected: 'Disconnected.',
  boxSideSkipped: 'The fleet side is clean. ccrc did not touch the box, so its side was left as it is.',
  applying: 'The change is being applied to the box. Its phases show here, and a failure shows as a line with Try again.',
  pairingLocked: 'Changed only by Replace',
  accessSourceLabel: 'Address the box sees ccrc connect from (only if the box refused the key)',
  sheetCancel: 'Cancel',
} as const;

/** What blocks the connected card, in the order they win: a changed host key (C9), a lost access key, a failed act. */
export type TestboxBlocked =
  | { readonly kind: 'host-key' }
  | { readonly kind: 'access' }
  | { readonly kind: 'failed'; readonly sub: TestboxAdminSub; readonly phase: string | null; readonly code: string | null };

/** The act subs whose failure the connected card shows as a blocked line (connect and parity belong to the flow). */
const FAILURE_SUBS: ReadonlySet<string> = new Set(['repair', 'apply-release', 'settings-box', 'settings-fleet', 'disconnect']);
const ACCESS_CODES: ReadonlySet<string> = new Set(['no-access-key', 'auth-refused']);

/** One blocked line for a status, or null: read from the status the verb wrote, never inferred. */
export function blockedOf(status: TestboxAdminStatus): TestboxBlocked | null {
  if (status.hostKey === 'changed') return { kind: 'host-key' };
  const act = status.act;
  if (act === null || act.outcome !== 'failed') return null;
  if (act.code !== null && ACCESS_CODES.has(act.code)) return { kind: 'access' };
  if (!FAILURE_SUBS.has(act.sub)) return null;
  return { kind: 'failed', sub: act.sub, phase: act.phase, code: act.code };
}

/** A setting row as the settings panel shows it: the text, and the value the input starts from. A value the card was never
 *  sent (a path, an address or a list: the verb's display classes) starts blank, which means "keep". */
export interface ManageRowLine { readonly shown: string; readonly original: string }

export function manageRowLine(row: BoxSettingRow | undefined): ManageRowLine {
  const M = TESTBOX_MANAGE_TEXT;
  if (row === undefined) return { shown: M.shownUnmeasured, original: '' };
  if (row.state === 'unmeasured') return { shown: M.shownUnmeasured, original: '' };
  if (row.state === 'refused') return { shown: M.shownRefused, original: '' };
  if ('value' in row && typeof row.value === 'string') return { shown: row.from === 'default' ? `${row.value} (${M.shownDefault})` : row.value, original: row.value };
  return { shown: row.from === 'default' || row.from === 'empty' ? M.shownNotSet : M.shownSet, original: '' };
}

/** The fleet host's own settings rows, from the nodes the Settings page already polls: the first node whose role runs the
 *  test box lane and whose box settings were read. Null when there is none, so the panel says so and offers no guess. */
export function fleetRowsOf(nodes: readonly NodeWire[] | null | undefined): readonly BoxSettingRow[] | null {
  for (const n of nodes ?? []) {
    if (n.role !== 'fleet' && n.role !== 'both') continue;
    const read = boxSettingsOf(n);
    if (typeof read !== 'string' && read.state === 'ok') return read.doc.settings;
  }
  return null;
}

/** The twelve fleet-host keys the card edits, in the contract's order, in one folded family. */
export const FLEET_EDIT_KEYS: readonly string[] = TESTBOX_FLEET_EDITABLE;

/** The four box keys the pairing rests on: the connected card shows them as read, never as a field (only Replace changes them). */
export const PAIRED_BOX_KEYS: readonly string[] = TESTBOX_PAIRED_BOX_KEYS;
