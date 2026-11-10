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
  TESTBOX_ACT_MAP, TESTBOX_ADMIN_CODE_SENTENCE, TESTBOX_BOX_KEYS, TESTBOX_SHAPE_CLASS, TESTBOX_SHAPE_SENTENCE, isBoxAddress,
  type TestboxAct, type TestboxAdminCode, type TestboxAdminPhase, type TestboxAdminStatus,
} from '../../../shared/testbox-admin';
import { TESTBOX_PARITY_REQUIRED_SENTENCE } from '../../../shared/api';

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
  badPort: 'The port is a whole number from 1 to 65535.',
  badLogin: 'A login user is lower-case letters, digits, _ and -.',
  next: 'Continue',
  // step 2
  keyIntro: 'ccrc makes its own key pair on the fleet host and keeps the private half there.',
  makeKey: 'Generate access key',
  makingKey: 'Making the key…',
  keyWhere: "Add this line to the login user's authorized_keys on the box.",
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
  repoCommand: 'Test command',
  addRepo: 'Add a repository',
  removeRepo: 'Remove',
  offered: 'From the fleet',
  badValue: (shape: string) => `Not ${shape}.`,
  badRepoName: 'A name is letters, digits, . _ and -.',
  badRepoUrl: 'An https or ssh URL such as https://git.invalid/team/project.',
  badRepoWord: 'Required.',
  badRepoRow: 'That row is not one the box can take. Check the install inputs.',
  needListen: 'The address the service listens on is required.',
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

export type BoxSettingFamily = 'runs' | 'storage' | 'network' | 'accounts';

/** The folded families, in the order the form draws them. Every one of the 28 box keys is in exactly one. */
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
]);

/** The key the address fills (`host:port`, the port the service listens on). */
export const TESTBOX_LISTEN_KEY = 'CCRC_TESTBOX_LISTEN';
/** The service port the form offers with the address (`CCRC_TESTBOX_LISTEN`'s port). It is a starting value the operator
 *  edits; no other part of ccrc reads it. */
export const TESTBOX_SERVICE_PORT = 8740;

const IPV4_LITERAL = /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/;

/** `CCRC_TESTBOX_LISTEN` for an address: `host:port` for an IPv4 literal, `[host]:port` for an IPv6 one, and blank for a
 *  host name, which the installer refuses there (the firewall takes addresses), so the operator fills it. */
export function listenFor(address: string, port: number = TESTBOX_SERVICE_PORT): string {
  if (IPV4_LITERAL.test(address)) return `${address}:${port}`;
  if (address.includes(':') && isBoxAddress(address)) return `[${address}]:${port}`;
  return '';
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

/** The fleet's repository, as the card offers it: GitHub's https form of a slug `_gh_repo_slug` measured (`owner/name`). */
export const GIT_HOST_BASE = 'https://github.com/';
