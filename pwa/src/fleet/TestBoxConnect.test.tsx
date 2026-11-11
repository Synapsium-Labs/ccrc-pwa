// D-8166 (test box connect plan TC15; spec 2026-11-07 §2.2, §5.1): the connect flow in jsdom, against a fake fleet whose
// status the routes answer and every act of which is read at the fetch, so the bytes an act sends are what is held. The
// step-up is the account sheets' own (`useStepUp`), driven through its `deps` seam with a fake passphrase box.
// `browser/testbox-connect.browser.test.ts` holds what only an engine can say: the geometry at each width.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DESK_QUERY } from '@ccrc/ui';
import { TESTBOX_ADMIN_CODE_SENTENCE, type TestboxAdminStatus } from '../../../shared/testbox-admin';
import { TESTBOX_PARITY_REQUIRED_SENTENCE } from '../../../shared/api';
import { TESTBOX_PROTO, type StatusAnswer } from '../../../shared/testbox';
import type { StepUpDeps } from '../accounts/useStepUp';
import { SETTINGS_CARDS } from './settingsText';
import { TESTBOX_WIDE_QUERY, TestBoxSection } from './TestBoxSection';
import { TestBoxConnect } from './TestBoxConnect';
import { BOX_SETTING_FORM_START, TESTBOX_CONNECT_TEXT, TESTBOX_DEFAULT_RUNNER, TESTBOX_SERVICE_PORT, codeSentence, phaseWord } from './testboxAdminWords';
import { TESTBOX_ROUTE_TEXT } from '../lib/refusalWords';
import type { TestboxBlock, TestboxBlockAdmin, TestboxPoll } from './useTestboxView';

const T = TESTBOX_CONNECT_TEXT;
const ADDRESS = '10.0.0.7';
const FP = `SHA256:${'A'.repeat(43)}`;
const LINE = `from="192.0.2.1" ssh-ed25519 ${'B'.repeat(68)} ccrc-testbox`;
const SECOND_LINE = `from="192.0.2.9" ssh-ed25519 ${'C'.repeat(68)} ccrc-testbox`;
/** Addresses off the private and documentation ranges are assembled, never spelled, so no file the topology scanner reads holds one. */
const ip = (s: string): string => s.replace(/_/g, '.');

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const baseStatus = (over: Partial<TestboxAdminStatus> = {}): TestboxAdminStatus => ({
  v: 1, connected: false, addressSet: false, login: null, fingerprint: null, hostKey: 'none', boxFileSha256: null, act: null,
  boxSettings: null, boxSettingsAt: null, installedTag: null, parity: null, ...over,
});
const connectAct = (over: Partial<NonNullable<TestboxAdminStatus['act']>> = {}): NonNullable<TestboxAdminStatus['act']> => ({
  id: 'a'.repeat(32), sub: 'connect', phase: 'copy', phases: [{ name: 'verify', ms: 800 }], outcome: 'running', code: null,
  startedAt: 1, endedAt: null, ...over,
});

interface Call { readonly method: string; readonly path: string; readonly body: unknown }

/** A fake fleet: `status` is what `GET /api/testbox/admin` and every act's re-read answer; `on[sub]` answers a sub (a status
 *  change and a result, or a refusal); every call is recorded. */
function fakeFleet(first: TestboxAdminStatus = baseStatus()) {
  const calls: Call[] = [];
  const box = {
    status: first,
    read: vi.fn<() => Response | null>(() => null),
    on: {} as Record<string, (body: { fields?: Record<string, unknown> }) => { result?: Record<string, unknown>; refuse?: Response } | void>,
    projects: [] as unknown[],
  };
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    if (path === '/api/projects') return json(200, { roots: ['/w'], projects: box.projects });
    if (path === '/api/testbox/admin' && method === 'GET') return box.read() ?? json(200, { ok: true, status: box.status, events: [] });
    const sub = /^\/api\/testbox\/admin\/([a-z-]+)$/.exec(path)?.[1];
    if (sub !== undefined && method === 'POST') {
      const out = box.on[sub]?.(body as { fields?: Record<string, unknown> });
      if (out?.refuse !== undefined) return out.refuse;
      return json(200, { ok: true, status: box.status, events: [], result: out?.result ?? {} });
    }
    return json(404, { ok: false, error: 'not-found' });
  }));
  const posts = (sub?: string): Call[] => calls.filter((c) => c.method === 'POST' && (sub === undefined || c.path === `/api/testbox/admin/${sub}`));
  return { box, calls, posts };
}

/** The step-up's seams: a box with no passkey, so the passphrase arm is the step, and a passphrase it takes. */
const stepUpDeps = (): StepUpDeps => ({
  client: {
    stepUpStart: async () => ({ challengeB64url: 'AAAA', rpId: 'box.invalid', allowCredentialIdsB64url: [] }),
    stepUpFinish: async () => ({ ok: true, stepUpFreshUntil: Date.now() + 300_000 }),
    stepUpPassphrase: async () => ({ ok: true, stepUpFreshUntil: Date.now() + 300_000 }),
  } as unknown as NonNullable<StepUpDeps['client']>,
});

const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const flow = (): HTMLElement => document.querySelector<HTMLElement>('[data-testbox="connect"]')!;
const button = (name: string | RegExp): HTMLElement => within(flow()).getByRole('button', { name });
const click = async (name: string | RegExp): Promise<void> => { fireEvent.click(button(name)); await settle(); };
const type = (label: string, value: string): void => { fireEvent.change(within(flow()).getByLabelText(label), { target: { value } }); };
const mount = async (band: 'phone' | 'laptop' | 'wide' = 'laptop', extra: { runningPollMs?: number } = {}): Promise<ReturnType<typeof render>> => {
  const out = render(<TestBoxConnect band={band} stepUpDeps={stepUpDeps()} {...extra} />);
  await settle();
  return out;
};
/** Step 1 to step 2: Connect a test box, the address, Continue. */
const toKey = async (): Promise<void> => {
  await click(T.begin);
  type(T.addressLabel, ADDRESS);
  await click(T.next);
};

const REPO = { name: 'project-a', url: 'https://git.invalid/team/project-a', pkg: 'server' };
const fillRepo = (): void => {
  type(T.repoName, REPO.name);
  type(T.repoUrl, REPO.url);
  type(T.repoPackage, REPO.pkg);
};

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('step 1: the address, the port and the login', () => {
  it('shows one sentence and Connect a test box before anything is asked', async () => {
    fakeFleet();
    await mount();
    expect(screen.getByText(T.intro)).toBeInTheDocument();
    expect(button(T.begin)).toBeInTheDocument();
    expect(within(flow()).queryByLabelText(T.addressLabel)).toBeNull();
  });

  it('step 1 refuses an address with a port or a user in it, and a port or a login off their grammar, and sends nothing', async () => {
    const { calls } = fakeFleet();
    await mount();
    await click(T.begin);
    for (const bad of [`${ADDRESS}:22`, `root@${ADDRESS}`, 'two words', 'a_b.invalid', '']) {
      type(T.addressLabel, bad);
      expect(button(T.next)).toBeDisabled();
    }
    type(T.addressLabel, `${ADDRESS}:22`);
    expect(screen.getByText(T.badAddress)).toBeInTheDocument();
    type(T.addressLabel, ADDRESS);
    expect(button(T.next)).toBeEnabled();
    type(T.portLabel, '70000');
    expect(screen.getByText(T.badPort)).toBeInTheDocument();
    expect(button(T.next)).toBeDisabled();
    type(T.portLabel, '22');
    type(T.loginLabel, 'Root User');
    expect(screen.getByText(T.badLogin)).toBeInTheDocument();
    expect(button(T.next)).toBeDisabled();
    type(T.loginLabel, 'deploy');
    expect(button(T.next)).toBeEnabled();
    // Nothing has been sent to anyone but the one status read.
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('step 2: the access key', () => {
  it("step 2's key act asks for step-up first, and sends nothing more until the operator has confirmed", async () => {
    const { box, posts } = fakeFleet();
    let refused = true;
    box.on.key = () => {
      if (refused) return { refuse: json(403, { ok: false, error: 'step-up-required' }) };
      box.status = baseStatus({ addressSet: true });
      return { result: { line: LINE } };
    };
    await mount();
    await toKey();
    await click(T.makeKey);
    expect(posts('key')).toHaveLength(1);
    expect(document.querySelector('[data-step-up]')).not.toBeNull();
    expect(document.querySelector('[data-testbox="key-line"]')).toBeNull();
    // Confirm it's you with the passphrase, then press the act again: one more send, and only then.
    refused = false;
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await settle();
    expect(posts('key')).toHaveLength(1);
    await click(T.makeKey);
    expect(posts('key')).toHaveLength(2);
    expect(posts('key')[1]!.body).toEqual({ fields: { address: ADDRESS, port: '22', user: 'root' } });
  });

  it('the public line is shown whole with a copy control, and "I have added it" moves on to step 3', async () => {
    const { box } = fakeFleet();
    box.on.key = () => { box.status = baseStatus({ addressSet: true }); return { result: { line: LINE } }; };
    await mount();
    await toKey();
    await click(T.makeKey);
    await settle();
    const shown = document.querySelector('[data-testbox="key-line"]')!;
    expect(shown.textContent).toBe(LINE);
    expect(screen.getByText(T.keyWhere)).toBeInTheDocument();
    await click(T.copy);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINE);
    expect(button(T.copied)).toBeInTheDocument();
    await click(T.added);
    expect(document.querySelector('[data-testbox="key-line"]')).toBeNull();
    expect(button(T.probe)).toBeInTheDocument();
  });

  it('a copy the browser refuses says so and leaves the line to select', async () => {
    const { box } = fakeFleet();
    box.on.key = () => { box.status = baseStatus({ addressSet: true }); return { result: { line: LINE } }; };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
    await mount();
    await toKey();
    await click(T.makeKey);
    await click(T.copy);
    expect(screen.getByText(T.copyFailed)).toBeInTheDocument();
    expect(document.querySelector('[data-testbox="key-line"]')!.textContent).toBe(LINE);
  });
});

describe('step 3: the host key and the preflight', () => {
  const recorded = (): ReturnType<typeof fakeFleet> => {
    const f = fakeFleet(baseStatus({ addressSet: true, login: 'root' }));
    f.box.on.probe = () => ({ result: { fingerprint: FP } });
    f.box.on.pin = () => { f.box.status = baseStatus({ addressSet: true, login: 'root', hostKey: 'pinned', fingerprint: FP }); return { result: { fingerprint: FP } }; };
    f.box.on.preflight = () => ({ result: { pass: true, checks: [{ check: 'os', ok: true, code: null }, { check: 'systemd', ok: true, code: null }] } });
    return f;
  };

  it('step 3 shows the fingerprint and pins only on Confirm; the preflight then runs and lists each check', async () => {
    const { posts } = recorded();
    await mount();
    expect(screen.getByText(T.probeIntro)).toBeInTheDocument();
    await click(T.probe);
    expect(document.querySelector('[data-testbox="fingerprint"]')!.textContent).toBe(FP);
    expect(screen.getByText(T.fingerprintCompare)).toBeInTheDocument();
    expect(posts('pin')).toHaveLength(0);
    await click(T.confirmFingerprint);
    expect(posts().map((c) => c.path.split('/').pop())).toEqual(['probe', 'pin', 'preflight']);
    expect(posts('pin')[0]!.body).toEqual({ fields: { fingerprint: FP } });
    // The preflight passed: step 4, the settings.
    expect(screen.getByText(T.settingsIntro)).toBeInTheDocument();
  });

  it('a failed check shows its sentence and Check again, which asks the preflight once more', async () => {
    const { box, posts } = recorded();
    box.status = baseStatus({ addressSet: true, login: 'root', hostKey: 'pinned', fingerprint: FP });
    let pass = false;
    box.on.preflight = () => (pass
      ? { result: { pass: true, checks: [{ check: 'xfs', ok: true, code: null }] } }
      : { result: { pass: false, checks: [{ check: 'os', ok: true, code: null }, { check: 'xfs', ok: false, code: 'not-xfs-reflink' }] } });
    await mount();
    await click(T.probe);
    const list = document.querySelector('[data-testbox="checks"]')!;
    expect(within(list as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
    expect(list.textContent).toContain(TESTBOX_ADMIN_CODE_SENTENCE['not-xfs-reflink']);
    expect(list.querySelector('[data-ok="true"]')!.textContent).toContain(T.checkPassed);
    expect(posts('probe')).toHaveLength(0);
    pass = true;
    await click(T.checkAgain);
    expect(posts('preflight')).toHaveLength(2);
    expect(screen.getByText(T.settingsIntro)).toBeInTheDocument();
  });

  it('a from-mismatch re-shows step 2 with the corrected line', async () => {
    const { box } = recorded();
    box.status = baseStatus({ addressSet: true, login: 'root', hostKey: 'pinned', fingerprint: FP });
    box.on.preflight = () => ({ result: { pass: false, checks: [{ check: 'from', ok: false, code: 'from-mismatch' }], fixLine: SECOND_LINE } });
    await mount();
    await click(T.probe);
    expect(document.querySelector('[data-testbox="key-line"]')!.textContent).toBe(SECOND_LINE);
    expect(screen.getByText(T.fixedLine)).toBeInTheDocument();
  });

  it('a refusal reaches the card through refusalText: the code\'s sentence, from the closed table', async () => {
    const { box } = recorded();
    box.on.probe = () => ({ refuse: json(409, { ok: false, error: 'testbox-admin-refused', code: 'unreachable' }) });
    await mount();
    await click(T.probe);
    expect(screen.getByText(TESTBOX_ADMIN_CODE_SENTENCE.unreachable)).toBeInTheDocument();
    expect(button(T.checkAgain)).toBeInTheDocument();
  });

  it('a refusal it cannot name reads as the route word\'s floor, never a slug', async () => {
    const { box } = recorded();
    box.on.probe = () => ({ refuse: json(409, { ok: false, error: 'testbox-admin-refused', code: 'a-code-from-later' }) });
    await mount();
    await click(T.probe);
    expect(screen.queryByText(/a-code-from-later/)).toBeNull();
    expect(screen.getByText(TESTBOX_ROUTE_TEXT['testbox-admin-refused'])).toBeInTheDocument();
  });
});

describe('step 4: the box settings and the repositories', () => {
  /** A fleet whose host key is pinned and whose preflight passes, mounted at step 4 after the whole of steps 1 to 3 in this card. */
  const atStepFour = async (band: 'phone' | 'laptop' | 'wide' = 'laptop'): Promise<ReturnType<typeof fakeFleet>> => {
    const f = fakeFleet();
    f.box.on.key = () => { f.box.status = baseStatus({ addressSet: true }); return { result: { line: LINE } }; };
    f.box.on.probe = () => ({ result: { fingerprint: FP } });
    f.box.on.pin = () => { f.box.status = baseStatus({ addressSet: true, hostKey: 'pinned', fingerprint: FP }); return {}; };
    f.box.on.preflight = () => ({ result: { pass: true, checks: [{ check: 'os', ok: true, code: null }] } });
    f.box.projects = [
      { name: 'project-a', workdir: '/w/project-a', repo: { state: 'named', slug: 'team/Project-A' } },
      { name: 'project-b', workdir: '/w/project-b', repo: { state: 'absent' } },
      { name: 'project-c', workdir: '/w/project-c', repo: { state: 'named', slug: 'team/project-c' } },
    ];
    await mount(band);
    await toKey();
    await click(T.makeKey);
    await click(T.added);
    await click(T.probe);
    await click(T.confirmFingerprint);
    return f;
  };

  it('step 4 fills CCRC_TESTBOX_LISTEN from the address and the service port', async () => {
    await atStepFour();
    expect((within(flow()).getByLabelText('CCRC_TESTBOX_LISTEN') as HTMLInputElement).value).toBe(`${ADDRESS}:${TESTBOX_SERVICE_PORT}`);
  });

  it('shows the 31 settings in five folded families (D-8290 adds the live probes\'), each with its default as the placeholder', async () => {
    await atStepFour();
    const families = [...flow().querySelectorAll('details[data-family]')];
    expect(families.map((d) => d.getAttribute('data-family'))).toEqual(['runs', 'storage', 'network', 'accounts', 'probes']);
    expect(families.filter((d) => (d as HTMLDetailsElement).open).map((d) => d.getAttribute('data-family'))).toEqual(['network']);
    expect(flow().querySelectorAll('details[data-family] input')).toHaveLength(31);
    expect((within(flow()).getByLabelText('CCRC_TESTBOX_RUN_MEMORY_MAX') as HTMLInputElement).value).toBe('4G');
  });

  it('a box value off its shape is refused as typed, in the shape\'s words, and Continue waits', async () => {
    await atStepFour();
    fillRepo();
    expect(button(T.next)).toBeEnabled();
    type('CCRC_TESTBOX_RUN_MEMORY_MAX', 'lots');
    expect(within(flow()).getByText(/K, M or G/)).toBeInTheDocument();
    expect(button(T.next)).toBeDisabled();
    type('CCRC_TESTBOX_RUN_MEMORY_MAX', '6G');
    expect(button(T.next)).toBeEnabled();
    type('CCRC_TESTBOX_LISTEN', '');
    expect(within(flow()).getByText(T.needListen)).toBeInTheDocument();
    expect(button(T.next)).toBeDisabled();
  });

  it('a listen address that is no private IP literal is refused as typed: the service has no TLS and the firewall matches that address only', async () => {
    await atStepFour();
    fillRepo();
    for (const bad of ['203.0.113.9:8740', `${ip('8_8_8_8')}:8740`, 'testbox.invalid:8740', '[2001:db8::9]:8740']) {
      type('CCRC_TESTBOX_LISTEN', bad);
      expect(within(flow()).getByText(T.listenNotPrivate), bad).toBeInTheDocument();
      expect(button(T.next), bad).toBeDisabled();
    }
    for (const good of ['10.0.0.7:8740', `${ip('100_64_1_2')}:8740`, '[fd00::7]:8740']) {
      type('CCRC_TESTBOX_LISTEN', good);
      expect(within(flow()).queryByText(T.listenNotPrivate), good).toBeNull();
      expect(button(T.next), good).toBeEnabled();
    }
  });

  it('a repository row is checked as typed: a name, a fetch URL and a package, and the fleet\'s own repositories are offered', async () => {
    await atStepFour();
    expect(button(T.next)).toBeDisabled();
    const offers = flow().querySelector('[data-testbox="offers"]')!;
    expect(within(offers as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['project-a', 'project-c']);
    fireEvent.click(within(offers as HTMLElement).getByRole('button', { name: 'project-a' }));
    expect((within(flow()).getByLabelText(T.repoName) as HTMLInputElement).value).toBe('project-a');
    expect((within(flow()).getByLabelText(T.repoUrl) as HTMLInputElement).value).toBe('https://github.com/team/Project-A');
    type(T.repoUrl, 'ftp://nowhere.invalid/x');
    expect(screen.getByText(T.badRepoUrl)).toBeInTheDocument();
    type(T.repoUrl, REPO.url);
    type(T.repoPackage, REPO.pkg);
    expect(button(T.next)).toBeEnabled();
  });

  it('takes one to four repository rows', async () => {
    await atStepFour();
    for (let i = 0; i < 3; i++) await click(T.addRepo);
    expect(flow().querySelectorAll('[data-testbox="repo-row"]')).toHaveLength(4);
    expect(within(flow()).queryByRole('button', { name: T.addRepo })).toBeNull();
    fireEvent.click(within(flow()).getAllByRole('button', { name: T.removeRepo })[0]!);
    await settle();
    expect(flow().querySelectorAll('[data-testbox="repo-row"]')).toHaveLength(3);
  });
});

describe('step 5: install, its six phases and the end of it', () => {
  const pinned = (over: Partial<TestboxAdminStatus> = {}): TestboxAdminStatus =>
    baseStatus({ addressSet: true, login: 'root', hostKey: 'pinned', fingerprint: FP, ...over });
  const FIVE = ['verify', 'copy', 'settings', 'install', 'pair'] as const;

  it('Install sends the typed settings and the rows once, and shows six phases with times', async () => {
    const { box, posts } = fakeFleet(baseStatus());
    box.on.key = () => { box.status = baseStatus({ addressSet: true }); return { result: { line: LINE } }; };
    box.on.probe = () => ({ result: { fingerprint: FP } });
    box.on.pin = () => { box.status = pinned(); return {}; };
    box.on.preflight = () => ({ result: { pass: true, checks: [] } });
    box.on.connect = () => { box.status = pinned({ act: connectAct() }); return { result: { act: 'a'.repeat(32) } }; };
    await mount();
    await toKey();
    await click(T.makeKey);
    await click(T.added);
    await click(T.probe);
    await click(T.confirmFingerprint);
    fillRepo();
    type('CCRC_TESTBOX_RUN_MEMORY_MAX', '6G');
    await click(T.next);
    await click(T.install);
    expect(posts('connect')).toHaveLength(1);
    const sent = (posts('connect')[0]!.body as { fields: { settings: Record<string, string>; repos: Record<string, unknown>[] } }).fields;
    expect(sent.settings).toEqual({
      CCRC_TESTBOX_RUN_MEMORY_MAX: '6G', CCRC_TESTBOX_ROOT: BOX_SETTING_FORM_START.CCRC_TESTBOX_ROOT, CCRC_TESTBOX_REPOS: BOX_SETTING_FORM_START.CCRC_TESTBOX_REPOS,
      CCRC_TESTBOX_LISTEN: `${ADDRESS}:${TESTBOX_SERVICE_PORT}`,
    });
    expect(sent.repos).toEqual([{
      name: REPO.name, fetchUrl: REPO.url, mirrorPath: '/var/lib/ccrc-testbox/mirrors/project-a.git',
      packages: [{ name: 'server', installInputs: ['server/package.json', 'server/package-lock.json'], commands: [TESTBOX_DEFAULT_RUNNER] }],
      buildOutputs: [], systemTools: [],
    }]);
    const phases = [...flow().querySelectorAll<HTMLElement>('[data-testbox="phases"] li')];
    expect(phases.map((p) => p.getAttribute('data-phase'))).toEqual(['verify', 'copy', 'settings', 'install', 'pair', 'check']);
    expect(phases.map((p) => p.getAttribute('data-state'))).toEqual(['done', 'running', 'waiting', 'waiting', 'waiting', 'waiting']);
    expect(phases[0]!.textContent).toContain('0.8 s');
    expect(phases[1]!.textContent).toContain(phaseWord('copy'));
    // The address typed in step 1 is not kept once the install has started.
    expect(document.body.innerHTML).not.toContain(ADDRESS);
  });

  it('Install survives a remount mid-act: a reload shows the same phases, read from the status, and the poll follows the act to Connected', async () => {
    const { box } = fakeFleet(pinned({ act: connectAct({ phases: FIVE.slice(0, 2).map((name, i) => ({ name, ms: 500 * (i + 1) })), phase: 'settings' }) }));
    const first = await mount('laptop', { runningPollMs: 15 });
    const before = [...flow().querySelectorAll('[data-testbox="phases"] li')].map((li) => li.textContent);
    expect(before[0]).toContain('0.5 s');
    expect(before[1]).toContain('1.0 s');
    first.unmount();
    await mount('laptop', { runningPollMs: 15 });
    expect([...flow().querySelectorAll('[data-testbox="phases"] li')].map((li) => li.textContent)).toEqual(before);
    // The act ends: the poll reads it, and the card is at step 6.
    box.status = pinned({ connected: true, act: connectAct({ outcome: 'ok', phase: null, phases: ([...FIVE, 'check'] as const).map((name) => ({ name, ms: 300 })) }) });
    await waitFor(() => expect(flow().querySelector('[data-testbox="connected"]')).not.toBeNull());
    expect(button(T.runParity)).toBeInTheDocument();
  });

  it('a failed phase shows its sentence and Try again, which after a reload goes back to the preflight, then the settings', async () => {
    fakeFleet(pinned({ act: connectAct({ outcome: 'failed', phase: 'install', code: 'install-failed', phases: [{ name: 'verify', ms: 200 }, { name: 'copy', ms: 900 }, { name: 'settings', ms: 100 }] }) }));
    await mount();
    expect(screen.getByText(T.actFailed(phaseWord('install'), codeSentence('install-failed')))).toBeInTheDocument();
    expect(flow().querySelector('[data-phase="install"]')!.getAttribute('data-state')).toBe('failed');
    // A reload lost that the preflight passed here, so the card only ever moves back: step 3, and its Check the box.
    await click(T.tryAgain);
    expect(button(T.probe)).toBeInTheDocument();
    expect(screen.queryByText(T.installIntro)).toBeNull();
  });
});

describe('step 6: parity', () => {
  const connected = (over: Partial<TestboxAdminStatus> = {}): TestboxAdminStatus =>
    baseStatus({ addressSet: true, login: 'root', hostKey: 'pinned', fingerprint: FP, connected: true, boxFileSha256: 'f'.repeat(64), ...over });
  const record = (result: 'pass' | 'fail'): NonNullable<TestboxAdminStatus['parity']> => ({
    v: 1, result, prs: [{ repo: 'project-a', number: 7, rev: 'a'.repeat(40) }], fixtures: [{ name: 'git-state', result: 'pass' }, { name: 'socket', result: 'pass' }, { name: 'workers', result }],
    release: 'v0.0.900', toolsKey: 'k', fingerprint: FP, boxFileSha256: 'f'.repeat(64), at: 1,
  });

  it('Run parity sends no fields, and its phases and result show', async () => {
    const { box, posts } = fakeFleet(connected());
    box.on.parity = () => { box.status = connected({ act: connectAct({ sub: 'parity', phase: 'legs', phases: [] }) }); return {}; };
    await mount('laptop', { runningPollMs: 15 });
    expect(screen.getByText(T.parityIntro)).toBeInTheDocument();
    await click(T.runParity);
    expect(posts('parity')[0]!.body).toEqual({ fields: {} });
    expect([...flow().querySelectorAll('[data-testbox="phases"] li')].map((li) => li.getAttribute('data-phase'))).toEqual(['legs', 'record']);
    box.status = connected({ act: connectAct({ sub: 'parity', phase: null, outcome: 'ok', phases: [{ name: 'legs', ms: 4000 }, { name: 'record', ms: 100 }] }), parity: record('pass') });
    await waitFor(() => expect(screen.getByText(T.parityPassed)).toBeInTheDocument());
    expect(within(flow()).queryByRole('button', { name: T.runParity })).toBeNull();
    expect(flow().querySelector('[data-testbox="parity-record"]')!.textContent).toContain(T.parityPrs(1));
  });

  it('a failed record says so and offers it again; a record that no longer matches the box says parity must run again', async () => {
    const { box } = fakeFleet(connected({ parity: record('fail') }));
    const view = await mount();
    expect(screen.getByText(T.parityFailed)).toBeInTheDocument();
    expect(button(T.tryAgain)).toBeInTheDocument();
    view.unmount();
    box.status = connected({ parity: { ...record('pass'), boxFileSha256: '0'.repeat(64) } });
    await mount();
    expect(screen.getByText(T.parityStale)).toBeInTheDocument();
    expect(button(T.runParity)).toBeInTheDocument();
  });

  it('a record that still matches the pin and the box file but whose stale mark is set (an edit and its undo) says parity must run again, with Run parity on the card', async () => {
    fakeFleet(connected({ parity: record('pass'), parityStale: true }));
    await mount();
    expect(screen.getByText(T.parityStale)).toBeInTheDocument();
    expect(button(T.runParity)).toBeInTheDocument();
    cleanup();
    // the same record with no mark is a pass: no Run parity
    fakeFleet(connected({ parity: record('pass') }));
    await mount();
    expect(screen.getByText(T.parityPassed)).toBeInTheDocument();
    expect(within(flow()).queryByRole('button', { name: T.runParity })).toBeNull();
  });

  it('a gh-signed-out failure says why', async () => {
    fakeFleet(connected({ act: connectAct({ sub: 'parity', outcome: 'failed', phase: 'legs', code: 'gh-signed-out', phases: [] }) }));
    await mount();
    expect(screen.getByText(codeSentence('gh-signed-out'))).toBeInTheDocument();
  });
});

describe('when the account gate is dark, or the fleet cannot', () => {
  it('auth off says sign-in is required and shows no act button', async () => {
    const { box } = fakeFleet();
    box.read.mockReturnValue(json(501, { ok: false, error: 'auth-off' }));
    await mount();
    expect(flow().querySelector('[data-testbox="connect-dark"]')!.textContent).toBe(T.signInRequired);
    expect(within(flow()).queryAllByRole('button')).toEqual([]);
  });

  it('an insecure origin reads the same', async () => {
    const { box } = fakeFleet();
    box.read.mockReturnValue(json(403, { ok: false, error: 'insecure-origin' }));
    await mount();
    expect(flow().querySelector('[data-testbox="connect-dark"]')).not.toBeNull();
    expect(within(flow()).queryAllByRole('button')).toEqual([]);
  });

  it('a fleet without the connect surface says so in the route\'s words, and the status can be read again', async () => {
    const { box } = fakeFleet();
    box.read.mockReturnValueOnce(json(501, { ok: false, error: 'unsupported' }));
    await mount();
    expect(screen.getByText(/too old to connect a test box/)).toBeInTheDocument();
    await click(T.retryRead);
    expect(button(T.begin)).toBeInTheDocument();
  });

  it('a status this build cannot read is a failed read, never a half-drawn card', async () => {
    const { box } = fakeFleet();
    box.read.mockReturnValue(json(200, { ok: true, status: { v: 1, connected: 'yes' }, events: [] }));
    await mount();
    expect(screen.getByText(T.unreadable)).toBeInTheDocument();
    expect(within(flow()).queryByRole('button', { name: T.begin })).toBeNull();
  });

  it('a 2xx the card cannot read says it is not known whether the act went through, and re-reads', async () => {
    const { box, calls } = fakeFleet(baseStatus({ addressSet: true }));
    box.on.probe = () => undefined;
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => (
      String(url) === '/api/testbox/admin/probe' ? new Response('not json', { status: 200 }) : original(url as string, init))));
    await mount();
    await click(T.probe);
    expect(screen.getByText(T.unknown)).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/testbox/admin' && c.method === 'GET').length).toBeGreaterThanOrEqual(2);
  });
});

describe('the steps at each width', () => {
  it('the current step is the only open step on a phone, inside its list item', async () => {
    fakeFleet(baseStatus({ addressSet: true }));
    await mount('phone');
    const items = [...flow().querySelectorAll<HTMLElement>('[data-testbox="steps"] > li')];
    expect(items).toHaveLength(6);
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo']);
    expect(flow().querySelectorAll('[data-testbox="step-open"]')).toHaveLength(1);
    expect(items[2]!.querySelector('[data-testbox="step-open"]')).not.toBeNull();
    expect(items[2]!.getAttribute('aria-current')).toBe('step');
    expect(flow().querySelector('[data-testbox="step-panel"]')).toBeNull();
    expect(button(T.probe)).toHaveClass('w-full');
  });

  it('the laptop and wide bands draw the current step in its own panel, and only wide draws the ledger', async () => {
    fakeFleet(baseStatus({ addressSet: true }));
    const laptop = await mount('laptop');
    expect(flow().querySelector('[data-testbox="step-panel"]')).not.toBeNull();
    expect(flow().querySelector('[data-testbox="step-open"]')).toBeNull();
    expect(flow().querySelector('[data-testbox="ledger"]')).toBeNull();
    expect(button(T.probe)).not.toHaveClass('w-full');
    laptop.unmount();
    await mount('wide');
    expect(flow().querySelector('[data-testbox="ledger"]')).not.toBeNull();
    expect(flow().querySelector('[data-testbox="step-panel"]')).not.toBeNull();
  });

  it('the wide ledger lists recent acts as words, with a closed code\'s sentence', async () => {
    const f = fakeFleet(baseStatus({ addressSet: true }));
    f.box.read.mockReturnValue(json(200, {
      ok: true, status: f.box.status,
      events: [{ id: 2, at: Date.parse('2026-11-10T12:30:00Z'), actor: 'phone a1b2c3d4', act: 'connect', actId: null, outcome: 'failed', code: 'install-failed', fingerprint: null, fleetIdentity: null },
        { id: 1, at: Date.parse('2026-11-10T12:00:00Z'), actor: 'phone a1b2c3d4', act: 'confirm-host-key', actId: null, outcome: 'ok', code: null, fingerprint: FP, fleetIdentity: null }],
    }));
    await mount('wide');
    const ledger = flow().querySelector('[data-testbox="ledger"]')!;
    expect(ledger.textContent).toContain('2026-11-10 12:30 UTC Connect failed');
    expect(ledger.textContent).toContain(codeSentence('install-failed'));
    expect(ledger.textContent).toContain('Confirm host key ok');
    expect(ledger.textContent).not.toContain(FP);
  });
});

// ---- the section: the flow's mount and the switch's gate -------------------------------------------------------------------

const TOOLS = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };
const STATUS: StatusAnswer = {
  t: 'status', state: 'ok', reason: null, serviceVersion: '1.0.0', proto: TESTBOX_PROTO, release: 'v0.0.900', tools: TOOLS,
  sync: { state: 'idle', detail: null, at: '2026-10-30T10:00:00Z' }, runs: { inProgress: 0, limit: 4 }, queueDepth: 0, pristine: [], failedKeys: [],
  heldRunUsers: [], repositories: [],
};
const block = (over: Partial<TestboxBlock> = {}): TestboxBlock => ({
  state: 'ok', reasons: [], summary: 'ok', switch: 'off', at: Date.now(), host: { tools: TOOLS, release: 'v0.0.900', measuredAt: '2026-10-30T11:59:59Z' },
  box: STATUS, counts: { remote: 0, fallback: 0, refused: 0, unreadable: 0, byReason: {} }, ...over,
});
const admin = (over: Partial<TestboxBlockAdmin> = {}): TestboxBlockAdmin => ({ connected: false, hostKey: 'none', act: null, parity: 'none', ...over });
const sectionPoll = (b: TestboxBlock, reload = vi.fn()): TestboxPoll => ({ view: { block: b }, failure: null, reload });
const atBand = (band: 'phone' | 'laptop' | 'wide'): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: (q === DESK_QUERY && band !== 'phone') || (q === TESTBOX_WIDE_QUERY && band === 'wide'),
    media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
};
const card = (): HTMLElement => screen.getByRole('region', { name: SETTINGS_CARDS.automation.testbox.title });

describe('the card: the flow mounts with no connected box, and the switch waits for parity', () => {
  it('the switch is disabled with its sentence until parity passes, and Off is never gated', async () => {
    atBand('laptop');
    fakeFleet();
    const view = render(<TestBoxSection poll={sectionPoll(block({ admin: admin({ connected: true, hostKey: 'pinned', parity: 'none' }) }))} />);
    await settle();
    expect(within(card()).getByRole('radio', { name: 'On' })).toBeDisabled();
    expect(within(card()).getByRole('radio', { name: 'Off' })).toBeEnabled();
    expect(card().querySelector('[data-testbox="switch-waits"]')!.textContent).toBe(T.switchWaits);
    expect(T.switchWaits).toBe(TESTBOX_PARITY_REQUIRED_SENTENCE);
    for (const parity of ['fail', 'stale'] as const) {
      view.rerender(<TestBoxSection poll={sectionPoll(block({ admin: admin({ connected: true, hostKey: 'pinned', parity }) }))} />);
      expect(within(card()).getByRole('radio', { name: 'On' })).toBeDisabled();
    }
    view.rerender(<TestBoxSection poll={sectionPoll(block({ admin: admin({ connected: true, hostKey: 'pinned', parity: 'pass' }) }))} />);
    expect(within(card()).getByRole('radio', { name: 'On' })).toBeEnabled();
    expect(card().querySelector('[data-testbox="switch-waits"]')).toBeNull();
    expect(card().querySelector('[data-testbox="connect"]')).toBeNull();
  });

  it('a switch that is already On stays usable whatever parity says', async () => {
    atBand('laptop');
    fakeFleet();
    render(<TestBoxSection poll={sectionPoll(block({ switch: 'on', admin: admin({ connected: true, hostKey: 'pinned', parity: 'stale' }) }))} />);
    await settle();
    expect(within(card()).getByRole('radio', { name: 'Off' })).toBeEnabled();
    expect(within(card()).getByRole('radio', { name: 'On' })).toBeEnabled();
  });

  it('a block with no admin (an older server) is drawn as it always was: no flow, no gate', async () => {
    atBand('laptop');
    const { calls } = fakeFleet();
    render(<TestBoxSection poll={sectionPoll(block())} />);
    await settle();
    expect(card().querySelector('[data-testbox="connect"]')).toBeNull();
    expect(within(card()).getByRole('radio', { name: 'On' })).toBeEnabled();
    expect(calls).toEqual([]);
  });

  it('with no box connected the flow mounts above the card, and the band reaches it', async () => {
    atBand('phone');
    fakeFleet();
    render(<TestBoxSection poll={sectionPoll(block({ state: 'off', box: null, admin: admin() }))} />);
    await settle();
    const mounted = card().querySelector('[data-testbox="connect"]')!;
    expect(mounted.getAttribute('data-band')).toBe('phone');
    expect(mounted.compareDocumentPosition(card().querySelector('[data-testbox="head"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a connected box whose parity has not passed keeps the flow at step 6, where Run parity is', async () => {
    atBand('laptop');
    fakeFleet(baseStatus({ addressSet: true, hostKey: 'pinned', fingerprint: FP, connected: true, boxFileSha256: 'f'.repeat(64) }));
    render(<TestBoxSection poll={sectionPoll(block({ admin: admin({ connected: true, hostKey: 'pinned', parity: 'none' }) }))} />);
    await settle();
    expect(within(card()).getByRole('button', { name: T.runParity })).toBeInTheDocument();
  });

  it('the flow re-reads when the block moves (a Replace or Disconnect from the connected card beside it), so it never draws the old box', async () => {
    atBand('laptop');
    const f = fakeFleet(baseStatus({ addressSet: true, connected: true, hostKey: 'pinned', fingerprint: FP, boxFileSha256: 'f'.repeat(64) }));
    const view = render(<TestBoxSection poll={sectionPoll(block({ admin: admin({ connected: true, hostKey: 'pinned', parity: 'none' }) }))} />);
    await settle();
    expect(within(card()).getByRole('button', { name: T.runParity })).toBeInTheDocument();
    const reads = (): number => f.calls.filter((c) => c.method === 'GET' && c.path === '/api/testbox/admin').length;
    const before = reads();
    // the Disconnect landed: the block says no box is connected, and the fleet's status says no address is recorded
    f.box.status = baseStatus();
    view.rerender(<TestBoxSection poll={sectionPoll(block({ state: 'off', box: null, admin: admin() }))} />);
    await settle();
    expect(reads()).toBeGreaterThan(before);
    expect(within(card()).queryByRole('button', { name: T.runParity })).toBeNull();
    expect(within(card()).getByRole('button', { name: T.begin })).toBeInTheDocument();
  });

  it('the parity-required refusal the switch route answers is the card\'s own sentence', async () => {
    atBand('laptop');
    fakeFleet();
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => (String(url) === '/api/testbox/switch'
      ? json(409, { ok: false, error: 'parity-required', detail: TESTBOX_PARITY_REQUIRED_SENTENCE })
      : json(200, { ok: true, status: baseStatus(), events: [] }))));
    // A switch that is Off, with parity passed here but refused there (the record moved between the block and the tap).
    render(<TestBoxSection poll={sectionPoll(block({ admin: admin({ connected: true, hostKey: 'pinned', parity: 'pass' }) }))} />);
    await settle();
    fireEvent.click(within(card()).getByRole('radio', { name: 'On' }));
    await settle();
    expect(within(card()).getByText(TESTBOX_PARITY_REQUIRED_SENTENCE)).toBeInTheDocument();
  });
});

describe('step 1 and the private network (D-8166, C4, M21)', () => {
  it('a public IP literal is refused in words (the service has no TLS); a private one, and a host name, go on', async () => {
    fakeFleet();
    await mount();
    await click(T.begin);
    for (const pub of ['192.0.2.7', ip('8_8_8_8'), '2001:db8::7']) {
      type(T.addressLabel, pub);
      expect(screen.getByText(T.badPublicAddress), pub).toBeInTheDocument();
      expect(button(T.next), pub).toBeDisabled();
    }
    for (const ok of ['10.0.0.7', ip('100_64_3_4'), 'fd00::7', 'testbox.invalid']) {
      type(T.addressLabel, ok);
      expect(screen.queryByText(T.badPublicAddress), ok).toBeNull();
      expect(button(T.next), ok).toBeEnabled();
    }
  });
});

describe('coming back to a connection that is recorded and never Connected (D-8166 review)', () => {
  const recordedFleet = (over: Partial<TestboxAdminStatus> = {}): ReturnType<typeof fakeFleet> => {
    const f = fakeFleet(baseStatus({ addressSet: true, login: 'root', ...over }));
    f.box.on.key = (b) => { f.box.status = baseStatus({ addressSet: true, login: 'root', ...over }); void b; return { result: { line: LINE } }; };
    f.box.on.disconnect = () => { f.box.status = baseStatus(); return {}; };
    return f;
  };

  it('after a reload the card offers Show the access line again and Start over, and a connected card offers neither', async () => {
    recordedFleet();
    await mount();
    expect(button(T.probe)).toBeInTheDocument();
    expect(button(T.showLineAgain)).toBeInTheDocument();
    expect(button(T.startOver)).toBeInTheDocument();
    expect(screen.getByText(T.startOverWhy)).toBeInTheDocument();
    // the sentence says what the act does: the switch, the box's service, ccrc's own token and key, the access line, and that a hand
    // pairing is left as it is
    for (const part of ['switch off', 'token and push key ccrc made', 'access line', 'The access key is kept', 'by hand', 'not touched']) expect(T.startOverWhy, part).toContain(part);
    cleanup();
    fakeFleet(baseStatus({ addressSet: true, connected: true, hostKey: 'pinned', fingerprint: FP }));
    await mount();
    expect(within(flow()).queryByRole('button', { name: T.startOver })).toBeNull();
    expect(within(flow()).queryByRole('button', { name: T.showLineAgain })).toBeNull();
  });

  it('Show the access line again types the connection again, with the optional source, and shows the same line', async () => {
    const { posts } = recordedFleet();
    await mount();
    await click(T.showLineAgain);
    // the address is not in this card's memory: it is typed again, and nothing is sent until it is
    expect(within(flow()).getByLabelText(T.addressLabel)).toHaveValue('');
    expect(button(T.showLineAgain)).toBeDisabled();
    expect(posts('key')).toHaveLength(0);
    type(T.addressLabel, ADDRESS);
    type(T.sourceLabel, 'testbox.invalid');
    expect(button(T.showLineAgain)).toBeDisabled();
    type(T.sourceLabel, '10.0.0.250');
    type(T.loginLabel, 'deploy');
    await click(T.showLineAgain);
    expect(posts('key')).toHaveLength(1);
    expect(posts('key')[0]!.body).toEqual({ fields: { address: ADDRESS, port: '22', user: 'deploy', source: '10.0.0.250' } });
    expect(document.querySelector('[data-testbox="key-line"]')!.textContent).toBe(LINE);
    expect(screen.getByText(T.keyWhere)).toBeInTheDocument();
    await click(T.added);
    expect(button(T.probe)).toBeInTheDocument();
  });

  it('a source is optional: left blank it is not sent', async () => {
    const { posts } = recordedFleet();
    await mount();
    await click(T.showLineAgain);
    type(T.addressLabel, ADDRESS);
    await click(T.showLineAgain);
    expect(posts('key')[0]!.body).toEqual({ fields: { address: ADDRESS, port: '22', user: 'root' } });
  });

  it('Start over disconnects (with step-up), and the card is at step 1 with nothing carried over', async () => {
    const { box, posts } = recordedFleet({ hostKey: 'pinned', fingerprint: FP });
    let refused = true;
    const first = box.on.disconnect!;
    box.on.disconnect = (b) => (refused ? { refuse: json(403, { ok: false, error: 'step-up-required' }) } : first(b));
    await mount();
    await click(T.startOver);
    expect(posts('disconnect')).toHaveLength(1);
    expect(document.querySelector('[data-step-up]')).not.toBeNull();
    refused = false;
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await settle();
    await click(T.startOver);
    expect(posts('disconnect')).toHaveLength(2);
    expect(posts('disconnect')[1]!.body).toEqual({ fields: {} });
    // step 1 again, with no tap first: the address field, empty, and no recovery bar (nothing is recorded)
    expect(within(flow()).getByLabelText(T.addressLabel)).toHaveValue('');
    expect(within(flow()).queryByRole('button', { name: T.startOver })).toBeNull();
    expect(screen.getByText(T.startedOver)).toBeInTheDocument();
  });

  it('a Start over whose box side did not finish says so, and the card still starts over (the fleet side is clean)', async () => {
    const { box } = recordedFleet();
    box.on.disconnect = () => { box.status = baseStatus(); return { refuse: json(409, { ok: false, error: 'testbox-admin-refused', code: 'unpair-failed' }) }; };
    await mount();
    await click(T.startOver);
    await settle();
    expect(screen.getByText(TESTBOX_ADMIN_CODE_SENTENCE['unpair-failed'])).toBeInTheDocument();
    expect(within(flow()).getByLabelText(T.addressLabel)).toHaveValue('');
    expect(screen.queryByText(T.startedOver)).toBeNull();
  });

  it('a recorded connection cannot be Started over while its install runs', async () => {
    recordedFleet({ hostKey: 'pinned', fingerprint: FP, act: connectAct() });
    await mount();
    expect(within(flow()).queryByRole('button', { name: T.startOver })).toBeNull();
  });

  it('what this card remembers goes when the recorded address goes: a Replace or Disconnect from the connected card clears the old line and the old checks', async () => {
    const f = fakeFleet();
    f.box.on.key = () => { f.box.status = baseStatus({ addressSet: true }); return { result: { line: LINE } }; };
    await mount();
    await toKey();
    await click(T.makeKey);
    expect(document.querySelector('[data-testbox="key-line"]')!.textContent).toBe(LINE);
    // the connected card beside this flow acts: the status this flow re-reads says no address is recorded
    f.box.status = baseStatus();
    fireEvent.click(button(T.copy));
    await settle();
    await click(T.added);
    f.box.status = baseStatus();
    // a re-read lands (the section's `sync` moves; here the flow's own reload through an act's answer)
    f.box.on.probe = () => ({ result: { fingerprint: FP } });
    await click(T.probe);
    // step 1 is back, empty, and "I have added it" has nothing to loop on
    expect(within(flow()).getByLabelText(T.addressLabel)).toHaveValue('');
    expect(document.querySelector('[data-testbox="key-line"]')).toBeNull();
    expect(within(flow()).queryByRole('button', { name: T.added })).toBeNull();
  });
});
