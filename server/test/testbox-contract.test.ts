// D-7404 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB2; spec 2026-10-28-test-box-design.md §2.4,
// §2.6, §2.7, §2.9, §2.10). The test box's shared contract, `shared/testbox.ts`: every frame round-trips through its
// one reader and refuses an extra field; the fallback list equals spec §2.4's rows in order; the version row and the
// card's cells over a table of pairs; the repository row's refusals and the ccrc-pwa row; the runs log line's reader.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RUNS_LOG_LINE, RUNS_LOG_LINE_MAX, TESTBOX_FALLBACK, TESTBOX_FALLBACK_ID_MAP, TESTBOX_PROTO, TESTBOX_STATE_MAP,
  TESTBOX_TOOLS, parseRepoRow, parseRunsLine, readTestboxFrame, versionCellsDiffer, versionRowDiffers,
  type TestboxFrame, type TestboxToolVersions,
} from '../../shared/testbox.js';

const RUN = '0123456789abcdef0123456789abcdef';
const TOOLS: TestboxToolVersions = { node: '22.11.0', npm: '10.9.0', tmux: '3.4', git: '2.43.0', python3: '3.12.3', chrome: '131.0.6778.85' };

/** One valid frame of each type, every optional-looking field filled. */
const FRAMES: Record<string, TestboxFrame> = {
  'run.submit': {
    t: 'run.submit', runId: RUN, repository: 'project-a', package: 'server', branch: 'feat/x',
    refs: ['head', 'base', 'snap', 'history-base', 'ledger-base'], outputs: ['server/dist'],
    argv: ['./node_modules/.bin/vitest', 'run', 'test/a.test.ts'], forward: { CCRC_HISTORY_BASE: 'a'.repeat(40) },
    ci: false, workers: 3, session: 'project-a-worker',
  },
  'run.submit (detached, clean)': {
    t: 'run.submit', runId: RUN, repository: 'project-a', package: 'pwa', branch: null, refs: ['head'], outputs: [],
    argv: ['npm', 'test'], forward: {}, ci: true, workers: 2, session: 's',
  },
  'run.log': { t: 'run.log', runId: RUN, offset: 4096, stream: 'stderr', bytes: Buffer.from('a line\n').toString('base64') },
  'run.summary': {
    t: 'run.summary', runId: RUN, exit: 1, failed: { files: ['test/a.test.ts'], tests: ['a > fails'] }, wallMs: 12000,
    prepareMs: 2400, logTail: ['', ' FAIL test/a.test.ts'], ranOn: 'test-box', workers: 3, localDefault: 6,
    builtOnBox: ['server/dist'], report: 'ok', prepareFailed: null,
  },
  'run.summary (prepare failed)': {
    t: 'run.summary', runId: RUN, exit: 0, failed: { files: [], tests: [] }, wallMs: 900, prepareMs: 900, logTail: [],
    ranOn: 'test-box', workers: 3, localDefault: null, builtOnBox: [], report: 'missing',
    prepareFailed: { id: 'install-failed', text: 'test box: install failed (pwa, exit 1)' },
  },
  'run.cancel': { t: 'run.cancel', runId: RUN },
  'tools.sync': { t: 'tools.sync', release: 'v0.0.830', versions: TOOLS, measuredAt: '2026-10-29T12:00:00Z' },
  status: {
    t: 'status', state: 'degraded', reason: 'tools differ (node 22.11.0 vs 22.10.0)', serviceVersion: '1.2.3', proto: TESTBOX_PROTO,
    release: 'v0.0.830', tools: { ...TOOLS, node: '22.10.0' }, sync: { state: 'failed', detail: 'chrome: checksum', at: '2026-10-29T11:00:00Z' },
    runs: { inProgress: 2, limit: 4 }, queueDepth: 5,
    pristine: [{ repository: 'project-a', package: 'server', key: 'ab12cd34' }],
    failedKeys: [{ repository: 'project-a', package: 'pwa', key: 'ef56', exit: 1, attempts: 2, nextAttempt: '2026-10-29T13:00:00Z' }],
    heldRunUsers: ['ccrc-tb-3'], repositories: [{ name: 'project-a', mirrorPath: '/srv/testbox/mirrors/project-a.git' }],
  },
  'status (ok)': {
    t: 'status', state: 'ok', reason: null, serviceVersion: '1.2.3', proto: 1, release: 'v10.20.3000', tools: TOOLS,
    sync: { state: 'idle', detail: null, at: null }, runs: { inProgress: 0, limit: 4 }, queueDepth: 0, pristine: [],
    failedKeys: [], heldRunUsers: [], repositories: [],
  },
};

describe('the frames: one reader each, every field checked (D-7404, D-7428)', () => {
  it('the protocol version is 1, and the server state map is the five states', () => {
    expect(TESTBOX_PROTO).toBe(1);
    expect(Object.keys(TESTBOX_STATE_MAP)).toEqual(['off', 'ok', 'degraded', 'down', 'unreachable']);
  });

  it.each(Object.keys(FRAMES))('%s round-trips through readTestboxFrame', (k) => {
    expect(readTestboxFrame(JSON.stringify(FRAMES[k]))).toEqual({ ok: true, value: FRAMES[k] });
  });

  it.each(Object.keys(FRAMES))('%s with an extra field is refused, at the top and in a nested object', (k) => {
    const r = readTestboxFrame(JSON.stringify({ ...FRAMES[k], extra: 1 }));
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/extra field extra$/) });
    const f = FRAMES[k] as unknown as Record<string, unknown>;
    const nested = Object.keys(f).find((x) => typeof f[x] === 'object' && f[x] !== null && !Array.isArray(f[x]) && x !== 'forward');
    if (nested !== undefined) {
      const r2 = readTestboxFrame(JSON.stringify({ ...f, [nested]: { ...(f[nested] as object), extra: 1 } }));
      expect(r2.ok, `${k}.${nested} with an extra field`).toBe(false);
    }
  });

  it.each(Object.keys(FRAMES))('%s with any one field missing is refused', (k) => {
    for (const field of Object.keys(FRAMES[k]).filter((x) => x !== 't')) {
      const { [field]: _gone, ...rest } = FRAMES[k] as unknown as Record<string, unknown>;
      expect(readTestboxFrame(JSON.stringify(rest)), `${k} without ${field}`).toEqual({ ok: false, reason: expect.stringContaining(`missing field ${field}`) });
    }
  });

  it('refusals: a bad run id, a ref twice, no head ref, an unknown ref, a bad env name, non-base64 bytes, an unknown type, not JSON', () => {
    const sub = FRAMES['run.submit'] as unknown as Record<string, unknown>;
    const bad = (o: unknown): boolean => readTestboxFrame(JSON.stringify(o)).ok;
    expect(bad({ ...sub, runId: RUN.toUpperCase() })).toBe(false);
    expect(bad({ ...sub, runId: RUN.slice(1) })).toBe(false);
    expect(bad({ ...sub, refs: ['head', 'head'] })).toBe(false);
    expect(bad({ ...sub, refs: ['base'] })).toBe(false);
    expect(bad({ ...sub, refs: ['head', 'stash'] })).toBe(false);
    expect(bad({ ...sub, forward: { 'lower-case': 'x' } })).toBe(false);
    expect(bad({ ...sub, argv: [] })).toBe(false);
    expect(bad({ ...sub, outputs: ['../dist'] })).toBe(false);
    expect(bad({ ...FRAMES['run.log'], bytes: 'not base64!' })).toBe(false);
    expect(bad({ ...FRAMES['run.summary'], exit: 256 })).toBe(false);
    expect(bad({ ...FRAMES['run.summary'], report: 'absent' })).toBe(false);
    expect(bad({ ...FRAMES['run.summary'], prepareFailed: { id: 'queue-full', text: 'x' } })).toBe(false);
    expect(bad({ ...FRAMES.status, state: 'unreachable' })).toBe(false);
    expect(bad({ ...FRAMES.status, reason: null })).toBe(false);
    expect(bad({ ...FRAMES['status (ok)'], reason: 'x' })).toBe(false);
    expect(bad({ ...FRAMES.status, runs: { inProgress: 5, limit: 4 } })).toBe(false);
    expect(bad({ ...FRAMES.status, repositories: [{ name: 'project-a', mirrorPath: 'relative/x.git' }] })).toBe(false);
    expect(bad({ ...FRAMES['tools.sync'], versions: { ...TOOLS, node: 'v22.11.0' } })).toBe(false);
    expect(bad({ ...FRAMES['tools.sync'], measuredAt: '2026-10-29T12:00:00.000Z' })).toBe(false);
    expect(bad({ t: 'req', runId: RUN })).toBe(false);
    expect(readTestboxFrame('{')).toEqual({ ok: false, reason: 'not JSON' });
  });
});

describe("the release field reads the release tag's own shape, not a tool version", () => {
  // The fleet host's release tag is `v<major>.<minor>.<patch>` (deploy/release-artifact.sh's SHAPE), and the tools
  // sync passes it on as-is; a tool version's reader would refuse the leading `v`.
  it.each(['v0.0.830', 'v1.2.3', 'v10.20.3000'])('a tools.sync and a status carrying %s round-trip', (tag) => {
    const sync = { ...FRAMES['tools.sync'], release: tag };
    expect(readTestboxFrame(JSON.stringify(sync))).toEqual({ ok: true, value: sync });
    const status = { ...FRAMES.status, release: tag };
    expect(readTestboxFrame(JSON.stringify(status))).toEqual({ ok: true, value: status });
  });

  it.each(['0.0.830', 'V0.0.830', 'v0.0', 'v0.0.830a', 'v0.0.830.1', 'v0.0.830-rc1', ' v0.0.830', 'v', '', 830])(
    'a release of %j is refused as not a release tag, in a tools.sync and in a status', (tag) => {
      const why = { ok: false, reason: 'release: not a release tag' };
      expect(readTestboxFrame(JSON.stringify({ ...FRAMES['tools.sync'], release: tag }))).toEqual(why);
      expect(readTestboxFrame(JSON.stringify({ ...FRAMES.status, release: tag }))).toEqual(why);
    });

  it('a tool version keeps its own reader: a leading v is still refused there', () => {
    expect(readTestboxFrame(JSON.stringify({ ...FRAMES['tools.sync'], versions: { ...TOOLS, node: 'v22.11.0' } })))
      .toEqual({ ok: false, reason: 'versions.node: not a version' });
  });
});

/** Spec §2.4's table, its order and words, typed once here as the literal the list must equal. */
const SPEC_FALLBACK = [
  ['off', 'the remote switch is on', 'test box: off'],
  ['not-set-up', "the repository is in the test box's table", 'test box: this repository is not set up there'],
  ['unreachable', 'the box answers its status call within the deadline (config, default 3 s) and is not `down`', 'test box: unreachable (<detail>)'],
  ['down', 'the box answers its status call within the deadline (config, default 3 s) and is not `down`', 'test box: down (<reason>)'],
  ['version-differs', "node major.minor, npm major, tmux major, git major, python3 major.minor and Chrome major match the fleet host's", 'test box: version differs (<name> <local> vs <remote>)'],
  ['protocol-differs', "the service's protocol version is the wrapper's", 'test box: protocol differs (<local> vs <remote>)'],
  ['queue-full', 'the queue is under its limit (config, default 20 waiting runs)', 'test box: queue full (<n> waiting)'],
  ['snapshot-refused', 'the snapshot passes the deny list', 'test box: snapshot refused (<paths>)'],
  ['snapshot-too-large', 'the snapshot is under its size caps', 'test box: snapshot too large (<path> <size>)'],
  ['unmerged-paths', 'the index has no unmerged entries', 'test box: unmerged paths'],
  ['runs-locally', 'the command is one the box runs (§2.5)', 'test box: <command> runs locally'],
  ['over-budget', "the file set's estimated time is under the budget (§2.5)", 'test box: over budget (<estimate>)'],
  ['prepare-failed', 'every git step of the checkout succeeds (§2.1)', 'test box: prepare failed (git <step>: <detail>)'],
  ['install-failed', "every package's clone or `npm ci` succeeds (§2.2)", 'test box: install failed (<package>, exit <n>)'],
  ['build-failed', 'every declared build output the local tree has builds (§2.2)', 'test box: build failed (<output>, exit <n>)'],
  ['waited', 'a queued run starts within the queue wait (config, default 10 min) (§2.8)', 'test box: waited <n> min'],
  ['lost-run', 'a dropped link reconnects within the reconnect deadline (config, default 60 s) (§2.4)', 'test box: lost the run'],
] as const;

describe('TESTBOX_FALLBACK: spec §2.4 in order, plus the two waits (D-7404)', () => {
  it('equals the spec rows, as a literal', () => {
    expect(TESTBOX_FALLBACK.map((r) => [r.id, r.check, r.text])).toEqual(SPEC_FALLBACK.map((r) => [...r]));
  });

  it('every id is the map, once, in the map\'s order', () => {
    expect(TESTBOX_FALLBACK.map((r) => r.id)).toEqual(Object.keys(TESTBOX_FALLBACK_ID_MAP));
  });

  it('every printed reason of the spec\'s table is a row text, in the spec\'s order', () => {
    const spec = readFileSync(new URL('../../docs/superpowers/specs/2026-10-28-test-box-design.md', import.meta.url), 'utf8');
    const section = spec.slice(spec.indexOf('### 2.4 Fallback'), spec.indexOf('### 2.5 '));
    const printed = section.split('\n').filter((l) => /^\| .* \| .* \| `test box: /.test(l))
      .flatMap((l) => [...l.slice(l.lastIndexOf('|', l.length - 2)).matchAll(/`(test box: [^`]+)`/g)].map((m) => m[1]));
    expect(printed.length, 'the table was read').toBe(15);
    expect(printed).toEqual(TESTBOX_FALLBACK.slice(0, 15).map((r) => r.text));
  });
});

describe('the version row and the card\'s cells (spec §2.4 row 4, §2.10)', () => {
  const PAIRS: { name: string; box: Partial<TestboxToolVersions>; row: string | null; cells: string[] }[] = [
    { name: 'the same versions', box: {}, row: null, cells: [] },
    { name: 'a node patch', box: { node: '22.11.1' }, row: null, cells: ['node'] },
    { name: 'a node minor', box: { node: '22.12.0' }, row: 'node', cells: ['node'] },
    { name: 'an npm minor', box: { npm: '10.8.2' }, row: null, cells: ['npm'] },
    { name: 'an npm major', box: { npm: '11.0.0' }, row: 'npm', cells: ['npm'] },
    { name: 'a Chrome build', box: { chrome: '131.0.6778.86' }, row: null, cells: ['chrome'] },
    { name: 'a Chrome major', box: { chrome: '132.0.6834.0' }, row: 'chrome', cells: ['chrome'] },
    { name: 'a tmux minor with a letter', box: { tmux: '3.3a' }, row: null, cells: ['tmux'] },
    { name: 'a tmux major', box: { tmux: '4.0' }, row: 'tmux', cells: ['tmux'] },
    { name: 'a git minor', box: { git: '2.47.1' }, row: null, cells: ['git'] },
    { name: 'a python3 patch', box: { python3: '3.12.7' }, row: null, cells: ['python3'] },
    { name: 'a python3 minor', box: { python3: '3.13.0' }, row: 'python3', cells: ['python3'] },
    { name: 'a version that does not parse', box: { git: 'unknown' }, row: 'git', cells: ['git'] },
    { name: 'two at once: the first in the card\'s order is the row\'s', box: { chrome: '132.0.6834.83', npm: '11.0.0', node: '22.11.9' }, row: 'npm', cells: ['node', 'npm', 'chrome'] },
  ];

  it.each(PAIRS)('$name', ({ box, row, cells }) => {
    const b = { ...TOOLS, ...box };
    const d = versionRowDiffers(TOOLS, b);
    expect(d === null ? null : d.tool).toBe(row);
    if (d !== null) expect(d).toEqual({ tool: row, local: TOOLS[d.tool], remote: b[d.tool] });
    expect(versionCellsDiffer(TOOLS, b)).toEqual(cells);
  });

  it('the six tools, in the card\'s order', () => {
    expect(TESTBOX_TOOLS).toEqual(['node', 'npm', 'tmux', 'git', 'python3', 'chrome']);
  });
});

/** Spec §2.6's first row, ccrc-pwa: four packages in install order (`pwa` resolves `ui` through its `file:` link, so
 *  its inputs add `ui/package.json`, spec §2.2), the command heads of §2.5, the three build outputs of §4. */
const CCRC_PWA_ROW = {
  name: 'ccrc-pwa',
  fetchUrl: 'https://testbox.invalid/project-a/ccrc-pwa.git',
  mirrorPath: '/srv/testbox/mirrors/ccrc-pwa.git',
  packages: [
    { name: 'server', installInputs: ['server/package.json', 'server/package-lock.json'], commands: ['./node_modules/.bin/vitest', './node_modules/.bin/tsc', 'npm test'] },
    { name: 'agent', installInputs: ['agent/package.json', 'agent/package-lock.json'], commands: ['./node_modules/.bin/vitest', './node_modules/.bin/tsc', 'npm test'] },
    { name: 'ui', installInputs: ['ui/package.json', 'ui/package-lock.json'], commands: ['./node_modules/.bin/tsc', 'npm test'] },
    { name: 'pwa', installInputs: ['pwa/package.json', 'pwa/package-lock.json', 'ui/package.json'], commands: ['./node_modules/.bin/vitest', './node_modules/.bin/tsc', 'npm test', 'npm run test:browser'] },
  ],
  buildOutputs: [
    { path: 'server/dist', package: 'server', build: ['npm', 'run', 'build'] },
    { path: 'server/dist-pwa', package: 'pwa', build: ['npm', 'run', 'build'] },
    { path: 'agent/dist', package: 'agent', build: ['npm', 'run', 'build'] },
  ],
  systemTools: ['git', 'tmux', 'python3', 'chrome', 'strace', 'jq'],
};

describe('parseRepoRow: spec §2.6\'s repository row, every field checked (D-7404)', () => {
  it('the ccrc-pwa row parses, field for field', () => {
    expect(parseRepoRow(JSON.stringify(CCRC_PWA_ROW))).toEqual({ ok: true, value: CCRC_PWA_ROW });
  });

  const with_ = (patch: Record<string, unknown>): string => JSON.stringify({ ...CCRC_PWA_ROW, ...patch });
  const pkg0 = CCRC_PWA_ROW.packages[0]!;
  const REFUSALS: [string, string, RegExp][] = [
    ['not JSON', '{"name":', /^not JSON$/],
    ['not an object', '[]', /^row: not an object$/],
    ['an extra field', with_({ owner: 'x' }), /^row: extra field owner$/],
    ['a missing field', JSON.stringify({ ...CCRC_PWA_ROW, systemTools: undefined }), /^row: missing field systemTools$/],
    ['an upper-case name', with_({ name: 'Project-A' }), /^name: /],
    ['a file fetch URL', with_({ fetchUrl: 'file:///srv/x.git' }), /^fetchUrl: /],
    ['a relative mirror path', with_({ mirrorPath: 'mirrors/x.git' }), /^mirrorPath: /],
    ['a mirror path with ..', with_({ mirrorPath: '/srv/../etc' }), /^mirrorPath: /],
    ['no packages', with_({ packages: [] }), /^packages: fewer than 1/],
    ['a package named twice', with_({ packages: [pkg0, pkg0] }), /^packages\[1\]\.name: duplicate$/],
    ['a package with no install inputs', with_({ packages: [{ ...pkg0, installInputs: [] }] }), /^packages\[0\]\.installInputs: /],
    ['an install input outside the tree', with_({ packages: [{ ...pkg0, installInputs: ['../package.json'] }] }), /^packages\[0\]\.installInputs\[0\]: /],
    ['a package with no command heads', with_({ packages: [{ ...pkg0, commands: [] }] }), /^packages\[0\]\.commands: /],
    ['a padded command head', with_({ packages: [{ ...pkg0, commands: [' npm test'] }] }), /^packages\[0\]\.commands\[0\]: /],
    ['an extra package field', with_({ packages: [{ ...pkg0, env: {} }] }), /^packages\[0\]: extra field env$/],
    ['an output for an unlisted package', with_({ buildOutputs: [{ path: 'x/dist', package: 'x', build: ['tsc'] }] }), /^buildOutputs\[0\]\.package: not a listed package$/],
    ['an output with no build command', with_({ buildOutputs: [{ path: 'server/dist', package: 'server', build: [] }] }), /^buildOutputs\[0\]\.build: /],
    ['an output named twice', with_({ buildOutputs: [CCRC_PWA_ROW.buildOutputs[0], CCRC_PWA_ROW.buildOutputs[0]] }), /^buildOutputs\[1\]\.path: duplicate$/],
    ['a tool named twice', with_({ systemTools: ['git', 'git'] }), /^systemTools\[1\]: duplicate$/],
  ];

  it.each(REFUSALS)('refuses %s, with its reason', (_n, json, reason) => {
    const r = parseRepoRow(json);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(reason);
  });
});

describe('the runs log line: parseRunsLine is the format\'s one reader (D-7445)', () => {
  const AT = '2026-10-29T12:34:56Z';
  it('the line documents four tab-separated fields and a 128-byte bound', () => {
    expect(RUNS_LOG_LINE.split('\t')).toHaveLength(4);
    expect(RUNS_LOG_LINE.endsWith('\n')).toBe(true);
    expect(RUNS_LOG_LINE_MAX).toBe(128);
  });

  it.each([
    [`${AT}\tremote\t-\t0`, { at: AT, outcome: 'remote', fallback: null, exit: 0 }],
    [`${AT}\tremote\t-\t1\n`, { at: AT, outcome: 'remote', fallback: null, exit: 1 }],
    [`${AT}\tfallback\tover-budget\t0`, { at: AT, outcome: 'fallback', fallback: 'over-budget', exit: 0 }],
    [`${AT}\tfallback\toff\t2\n`, { at: AT, outcome: 'fallback', fallback: 'off', exit: 2 }],
    [`${AT}\trefused\tover-budget\t75`, { at: AT, outcome: 'refused', fallback: 'over-budget', exit: 75 }],
  ])('accepts %j', (line, row) => {
    expect(parseRunsLine(line)).toEqual(row);
  });

  it('accepts every fallback id on a fallback line', () => {
    for (const id of Object.keys(TESTBOX_FALLBACK_ID_MAP)) expect(parseRunsLine(`${AT}\tfallback\t${id}\t0`), id).not.toBeNull();
  });

  it.each([
    ['a fifth field', `${AT}\tremote\t-\t0\textra`],
    ['three fields', `${AT}\tremote\t0`],
    ['an unknown id', `${AT}\tfallback\tno-such-reason\t0`],
    ['a remote line carrying an id', `${AT}\tremote\tover-budget\t0`],
    ['a fallback line without an id', `${AT}\tfallback\t-\t0`],
    ['a refused line without an id', `${AT}\trefused\t-\t75`],
    ['a refused line whose exit is not 75', `${AT}\trefused\tover-budget\t1`],
    ['an unknown outcome', `${AT}\tlocal\t-\t0`],
    ['a time with milliseconds', `2026-10-29T12:34:56.000Z\tremote\t-\t0`],
    ['a time not in UTC', `2026-10-29T12:34:56+01:00\tremote\t-\t0`],
    ['an impossible date', `2026-02-30T12:34:56Z\tremote\t-\t0`],
    ['an exit over 255', `${AT}\tremote\t-\t256`],
    ['an exit with a leading zero', `${AT}\tremote\t-\t01`],
    ['two lines', `${AT}\tremote\t-\t0\n${AT}\tremote\t-\t0`],
    ['a line over 128 bytes', `${AT}\tfallback\tover-budget\t0${' '.repeat(128)}`],
  ])('refuses %s', (_n, line) => {
    expect(parseRunsLine(line)).toBeNull();
  });

  it('the longest line the fields allow, with its newline, is inside the bound, so the writer never has to cut one', () => {
    const longestId = Object.keys(TESTBOX_FALLBACK_ID_MAP).reduce((a, b) => (b.length > a.length ? b : a));
    const longest = `${AT}\tfallback\t${longestId}\t255`;
    expect(Buffer.byteLength(`${longest}\n`)).toBeLessThanOrEqual(RUNS_LOG_LINE_MAX);
    expect(parseRunsLine(`${longest}\n`)).not.toBeNull();
  });
});
