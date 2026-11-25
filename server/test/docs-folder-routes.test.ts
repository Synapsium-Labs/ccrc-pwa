// `server/src/docs/routes.ts`'s outside-folder doors (X2 P2.3; spec 2026-11-18 sections 4.1 and 7; plan Task P2.3). The seven
// doors are driven over the REAL adapter (`ccdsource.ts`) and a scripted `CcdRunner` that models the fleet's registry, through
// Fastify's real parser (`app.inject`), and every case counts the argv the runner recorded: "refuses before any exec" is
// `calls` staying empty. The sign-in verdict, the account gate with its step-up, and the label and path checks are the
// subjects; ccd's own admission has its own suites (`ccd-docs-folder*.test.ts`).
//
// Fixtures carry placeholders only: labels `notes` and `team-a`, one fixture path that must show in `paths` and in no other
// answer. The marker header is L0's constant (`PWA_HEADERS`), never quoted here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DOCS_CAP, DOCS_FOLDERS_CAP } from '../src/ccdargv.js';
import { docsShowPlan } from '../src/docs/policy.js';
import { DOCS_RANGE_FRAME_BYTES, docsApi, type DocsRangePin } from '../../shared/docs.js';
import {
  FOLDER_FIXTURE_PATH, PWA_HEADERS, docsApp, faultRes, folderHeaders, line, okRes, scripted, sha256Hex, type FolderRig,
} from './docsRouteHelpers.js';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0)) await app.close();
});

const BYTES = Buffer.from('# Hello\n');
const FP = sha256Hex(BYTES);
const MTIME = '1700000000000000000';
const SNAPSHOT = 'e'.repeat(32);
const FOLDER_VERBS = ['caps', DOCS_CAP, DOCS_FOLDERS_CAP];

/** One ccd failure line of `verb`. */
const failed = (verb: string, failure: string, more: Record<string, unknown> = {}): string =>
  line({ v: 1, verb, ok: false, elapsedMs: 1, failure, ...more });

/**
 * A scripted fleet: `registry` maps label to its path (`null`: an unreadable entry), and every folder verb answers as ccd does.
 * A path with `secret` in it is refused `protected` (a stand-in for ccd's admission, which names a reason and never the path).
 */
function fleet(initial: readonly (readonly [string, string | null])[] = [['notes', FOLDER_FIXTURE_PATH], ['team-a', null]]) {
  const registry = new Map<string, string | null>(initial);
  const made = scripted((argv) => {
    if (argv[0] === 'docs-folder') {
      const label = argv[2]!;
      if (argv[1] === '--list') {
        return okRes(line({
          v: 1, verb: 'docs-folder', ok: true, elapsedMs: 2,
          folders: [...registry].map(([l, p]) => ({ label: l, path: p, state: p === null ? 'unreadable' : 'ok' })),
        }));
      }
      if (argv[1] === '--add') {
        if (registry.has(label)) return okRes(failed('docs-folder', 'label-exists'));
        if (argv[4]!.includes('secret')) return okRes(failed('docs-folder', 'protected', { reason: 'ssh' }));
        registry.set(label, argv[4]!);
        return okRes(line({ v: 1, verb: 'docs-folder', ok: true, elapsedMs: 2, label }));
      }
      if (!registry.has(label)) return okRes(failed('docs-folder', 'unknown-folder'));
      registry.delete(label);
      return okRes(line({ v: 1, verb: 'docs-folder', ok: true, elapsedMs: 2, label, removed: true }));
    }
    const label = argv[2]!;
    if (!registry.has(label)) return okRes(failed('docs-folder-read', 'unknown-folder'));
    const op = argv[4];
    const env = { v: 1, verb: 'docs-folder-read', ok: true, elapsedMs: 3 };
    if (op === 'tree') {
      return okRes(line({
        ...env, label,
        entries: [{ section: 'specs', path: 'a.md', kind: 'file', size: BYTES.length, mtimeNs: MTIME, fp: FP }],
        unlisted: { count: 0, byReason: {} },
      }));
    }
    if (op === 'show') {
      return okRes(line({
        ...env, label, source: 'folder', section: argv[6], path: argv[8], size: BYTES.length, sha256: FP, fp: argv[10],
        mtimeNs: MTIME, encoding: 'base64', b64: BYTES.toString('base64'),
      }));
    }
    if (op === 'prepare') return okRes(line({ ...env, snapshot: SNAPSHOT, size: BYTES.length, digest: FP }));
    const offset = Number(argv[14]);
    const slice = BYTES.subarray(offset, offset + Number(argv[16]));
    return okRes(line({
      ...env, snapshot: argv[12], offset, bytesB64: slice.toString('base64'), digest: sha256Hex(slice), total: BYTES.length,
    }));
  });
  return { ...made, registry };
}

/** The doors' app over `fleet()`, closed after the case. `verbs` defaults to a fleet with the folder token. */
async function open(o: { rig?: FolderRig; verbs?: string[] | null; fleet?: ReturnType<typeof fleet> } = {}) {
  const f = o.fleet ?? fleet();
  const rig: FolderRig = o.rig ?? { signIn: 'armed' };
  const made = await docsApp({
    run: f.run, verbs: o.verbs === undefined ? FOLDER_VERBS : o.verbs, folders: rig,
  });
  apps.push(made.app);
  return { ...made, ...f, rig };
}

const PIN: DocsRangePin = { kind: 'fp', sha: FP };
/** The five read doors' URLs, as `docsApi` builds them. */
const READ_DOORS: readonly (readonly [string, string])[] = [
  ['list', docsApi.folders()],
  ['paths', docsApi.folderPaths()],
  ['tree', docsApi.folderTree('notes')],
  ['file', docsApi.folderFile('notes', 'specs', 'a.md', FP)],
  ['range', docsApi.folderRangePrepare('notes', 'specs', 'a.md', PIN)],
];

describe('folder doors: the sign-in gate (M11.6)', () => {
  it('folder doors: every read refuses auth-off while dark, with zero execs, whatever the session says', async () => {
    const t = await open({ rig: { signIn: 'dark' } });
    for (const session of [true, false]) {
      for (const [name, url] of READ_DOORS) {
        const res = await t.app.inject({ method: 'GET', url, headers: folderHeaders({ session }) });
        expect({ name, session, status: res.statusCode, body: res.json() })
          .toEqual({ name, session, status: 501, body: { ok: false, failure: 'auth-off' } });
      }
    }
    expect(t.calls).toEqual([]);
  });

  it('folder doors: every read refuses unauthenticated when armed without a session, with zero execs', async () => {
    const t = await open();
    for (const [name, url] of READ_DOORS) {
      const res = await t.app.inject({ method: 'GET', url, headers: folderHeaders({ session: false }) });
      expect({ name, status: res.statusCode, body: res.json() })
        .toEqual({ name, status: 401, body: { ok: false, failure: 'unauthenticated' } });
    }
    expect(t.calls).toEqual([]);
  });

  it('folder doors: add needs the step-up and refuses dark', async () => {
    const dark = await open({ rig: { signIn: 'dark' } });
    const post = (t: typeof dark, headers: Record<string, string>) => t.app.inject({
      method: 'POST', url: docsApi.folderAdd(), headers, payload: { label: 'extra', path: '/fixture/outside/extra-root' },
    });
    const refusedDark = await post(dark, folderHeaders({ stepUp: true }));
    expect(refusedDark.statusCode).toBe(501);
    expect(refusedDark.json()).toEqual({ ok: false, error: 'auth-off' });
    expect(dark.calls).toEqual([]);

    const armed = await open();
    const noStep = await post(armed, folderHeaders());
    expect(noStep.statusCode).toBe(403);
    expect(noStep.json()).toEqual({ ok: false, error: 'step-up-required' });
    const noSession = await post(armed, folderHeaders({ session: false, stepUp: true }));
    expect(noSession.statusCode).toBe(401);
    expect(armed.calls).toEqual([]);

    const done = await post(armed, folderHeaders({ stepUp: true }));
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ ok: true, label: 'extra' });
    expect(armed.calls).toEqual([['docs-folder', '--add', 'extra', '--path', '/fixture/outside/extra-root']]);
  });

  it('folder doors: remove works dark, with no session and no step-up', async () => {
    const t = await open({ rig: { signIn: 'dark' } });
    const res = await t.app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: folderHeaders({ session: false }) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, label: 'notes', removed: true });
    expect(t.calls).toEqual([['docs-folder', '--remove', 'notes']]);
  });

  it('folder doors: remove armed without a session is unauthenticated, with zero execs, and with one it goes through', async () => {
    const t = await open();
    const no = await t.app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: folderHeaders({ session: false }) });
    expect(no.statusCode).toBe(401);
    expect(no.json()).toEqual({ ok: false, failure: 'unauthenticated' });
    expect(t.calls).toEqual([]);
    const yes = await t.app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: folderHeaders() });
    expect(yes.statusCode).toBe(200);
    expect(t.calls).toEqual([['docs-folder', '--remove', 'notes']]);
  });
});

describe('folder doors: the label and the path are checked before any exec', () => {
  const BAD_LABELS: readonly (readonly [string, string])[] = [
    ['dot dot', '%2E%2E'], ['a slash', 'a%2Fb'], ['a leading dot', '.x'], ['an upper-case letter', 'A'],
    ['33 characters', 'a'.repeat(33)], ['a control character', 'a%01b'], ['a leading dash', '-a'],
  ];

  it.each(BAD_LABELS)('folder doors: a label outside the grammar (%s) is refused before any exec', async (_what, label) => {
    const t = await open();
    const reads = ['tree', 'file?section=specs&path=a.md&fp=' + FP, 'range?section=specs&path=a.md&pin=fp:' + FP + '&prepare=1'];
    // `..` as a whole path segment never reaches a handler: Fastify's router normalises it and answers its own 404, which is
    // a refusal before any exec all the same. Every other label reaches `parseDocsFolderLabel` and is a 400 `bad-label`,
    // ccd's own word, which never echoes the label.
    const routed = label === '%2E%2E';
    for (const tail of reads) {
      const res = await t.app.inject({ method: 'GET', url: `/api/docs-folders/${label}/${tail}`, headers: folderHeaders() });
      expect({ tail, status: res.statusCode, failure: routed ? undefined : res.json().failure })
        .toEqual({ tail, status: routed ? 404 : 400, failure: routed ? undefined : 'bad-label' });
    }
    const removed = await t.app.inject({ method: 'DELETE', url: `/api/docs-folders/${label}`, headers: folderHeaders() });
    expect(removed.statusCode).toBe(routed ? 404 : 400);
    if (!routed) expect(removed.json()).toEqual({ ok: false, failure: 'bad-label' });
    expect(t.calls).toEqual([]);
  });

  it('folder doors: an Add body with a bad label, a bad path or a stray key is refused before any exec, never echoing the path', async () => {
    const t = await open();
    const hostile = '/fixture/outside/../etc/hostile-root';
    // A label or a path outside its grammar answers ccd's own word for it; a body of the wrong shape is `bad-query`.
    const bodies: readonly (readonly [unknown, string])[] = [
      [{ label: '..', path: '/fixture/outside/ok-root' }, 'bad-label'], [{ label: 'A', path: '/fixture/outside/ok-root' }, 'bad-label'],
      [{ label: 'ok', path: hostile }, 'bad-path'], [{ label: 'ok', path: 'relative/hostile-root' }, 'bad-path'],
      [{ label: 'ok', path: '/fixture//hostile-root' }, 'bad-path'], [{ label: 'ok', path: '/fixture/hostile-root/' }, 'bad-path'],
      [{ label: 'ok', path: '/fixture/./hostile-root' }, 'bad-path'], [{ label: 'ok', path: `/fixture/${'x'.repeat(4100)}` }, 'bad-path'],
      [{ label: 'ok', path: '/fixture/bad\u0001hostile-root' }, 'bad-path'], [{ label: 'ok', path: '/' }, 'bad-path'],
      [{ label: 'ok' }, 'bad-query'], [{ path: '/fixture/outside/ok-root' }, 'bad-query'], [[], 'bad-query'], ['text', 'bad-query'],
      [{ label: 'ok', path: '/fixture/outside/ok-root', extra: 1 }, 'bad-query'],
      [{ label: 1, path: '/fixture/outside/ok-root' }, 'bad-query'],
    ];
    for (const [payload, want] of bodies) {
      const res = await t.app.inject({
        method: 'POST', url: docsApi.folderAdd(), headers: folderHeaders({ stepUp: true }),
        payload: payload as never,
      });
      expect({ payload: JSON.stringify(payload).slice(0, 60), status: res.statusCode, failure: res.json().failure })
        .toEqual({ payload: JSON.stringify(payload).slice(0, 60), status: 400, failure: want });
      for (const echoed of ['hostile-root', 'ok-root']) expect(res.body, 'the refusal never echoes a path').not.toContain(echoed);
    }
    expect(t.calls).toEqual([]);
  });

  it('folder doors: an Add whose path is a good shape reaches ccd, and a ccd refusal names its word and never the path', async () => {
    const t = await open();
    const secretPath = '/fixture/outside/secret-keys-root';
    const res = await t.app.inject({
      method: 'POST', url: docsApi.folderAdd(), headers: folderHeaders({ stepUp: true }), payload: { label: 'keys', path: secretPath },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ ok: false, failure: 'protected', reason: 'ssh' });
    expect(res.body).not.toContain(secretPath);
    expect(res.body).not.toContain('secret-keys-root');
    expect(t.calls).toHaveLength(1);
    const taken = await t.app.inject({
      method: 'POST', url: docsApi.folderAdd(), headers: folderHeaders({ stepUp: true }), payload: { label: 'notes', path: '/fixture/outside/other-root' },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ ok: false, failure: 'label-exists' });
  });

  it('folder doors: a file or range query outside its shape is refused before any exec', async () => {
    const t = await open();
    const urls = [
      '/api/docs-folders/notes/tree?x=1',
      '/api/docs-folders/notes/file?section=specs&path=a.md',
      `/api/docs-folders/notes/file?section=specs&path=a.md&fp=${FP}&maxBytes=1`,
      `/api/docs-folders/notes/file?section=nope&path=a.md&fp=${FP}`,
      `/api/docs-folders/notes/file?section=specs&path=${encodeURIComponent('../a.md')}&fp=${FP}`,
      `/api/docs-folders/notes/file?section=specs&path=a.md&fp=${'z'.repeat(64)}`,
      `/api/docs-folders/notes/file?commit=${'a'.repeat(40)}&section=specs&path=a.md&fp=${FP}`,
      `/api/docs-folders/notes/range?section=specs&path=a.md&pin=blob:${'b'.repeat(40)}&prepare=1`,
      `/api/docs-folders/notes/range?section=specs&path=a.md&pin=fp:${FP}`,
      `/api/docs-folders/notes/range?section=specs&path=a.md&pin=fp:${FP}&snapshot=${SNAPSHOT}&offset=0&length=${DOCS_RANGE_FRAME_BYTES + 1}`,
      `/api/docs-folders/notes/range?branch=main&head=${'a'.repeat(40)}&section=specs&path=a.md&pin=fp:${FP}&prepare=1`,
    ];
    for (const url of urls) {
      const res = await t.app.inject({ method: 'GET', url, headers: folderHeaders() });
      expect({ url, ok: res.statusCode >= 400 && res.statusCode < 500 }).toEqual({ url, ok: true });
    }
    expect(t.calls).toEqual([]);
  });

  it('folder doors: missing docs marker is 403, on every door, with zero execs', async () => {
    const t = await open();
    const bare = { cookie: folderHeaders().cookie!, [Object.keys(PWA_HEADERS)[0]!]: 'nope' };
    for (const [, url] of READ_DOORS) {
      const res = await t.app.inject({ method: 'GET', url, headers: bare });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ ok: false, failure: 'foreign-request' });
    }
    const add = await t.app.inject({ method: 'POST', url: docsApi.folderAdd(), headers: { cookie: bare.cookie }, payload: { label: 'x', path: '/a' } });
    const del = await t.app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: { cookie: bare.cookie } });
    expect([add.statusCode, del.statusCode]).toEqual([403, 403]);
    expect(t.calls).toEqual([]);
  });
});

describe('folder doors: armed with a session, each door answers through the scripted fleet', () => {
  it('lists: labels only on one door, labels and paths on the other', async () => {
    const t = await open();
    const labels = await t.app.inject({ method: 'GET', url: docsApi.folders(), headers: folderHeaders() });
    expect(labels.statusCode).toBe(200);
    expect(labels.json()).toEqual({ ok: true, folders: [{ label: 'notes', state: 'ok' }, { label: 'team-a', state: 'unreadable' }] });
    expect(labels.body, 'GET /api/docs-folders answers labels only, never a path').not.toContain(FOLDER_FIXTURE_PATH);
    expect(labels.body).not.toContain('"path"');
    const paths = await t.app.inject({ method: 'GET', url: docsApi.folderPaths(), headers: folderHeaders() });
    expect(paths.statusCode).toBe(200);
    expect(paths.json()).toEqual({
      ok: true,
      folders: [{ label: 'notes', path: FOLDER_FIXTURE_PATH, state: 'ok' }, { label: 'team-a', path: null, state: 'unreadable' }],
    });
    expect(t.calls).toEqual([['docs-folder', '--list'], ['docs-folder', '--list']]);
  });

  it('reads: a tree, a file and a range prepare and frame', async () => {
    const t = await open();
    const tree = await t.app.inject({ method: 'GET', url: docsApi.folderTree('notes'), headers: folderHeaders() });
    expect(tree.statusCode).toBe(200);
    expect(tree.json().tree).toMatchObject({
      label: 'notes', entries: [{ section: 'specs', path: 'a.md', kind: 'file', size: BYTES.length, mtimeNs: MTIME, fp: FP }],
    });
    const file = await t.app.inject({ method: 'GET', url: docsApi.folderFile('notes', 'specs', 'a.md', FP), headers: folderHeaders() });
    expect(file.statusCode).toBe(200);
    expect(file.json()).toMatchObject({
      ok: true, contentClass: 'markdown',
      show: { label: 'notes', source: 'folder', section: 'specs', path: 'a.md', size: BYTES.length, sha256: FP, fp: FP, mtimeNs: MTIME, encoding: 'base64' },
    });
    const prepare = await t.app.inject({ method: 'GET', url: docsApi.folderRangePrepare('notes', 'specs', 'a.md', PIN), headers: folderHeaders() });
    expect(prepare.statusCode).toBe(200);
    expect(prepare.json()).toEqual({ ok: true, prepared: { snapshot: SNAPSHOT, size: BYTES.length, digest: FP } });
    const frame = await t.app.inject({
      method: 'GET', url: docsApi.folderRangeFrame('notes', 'specs', 'a.md', PIN, SNAPSHOT, 0, BYTES.length), headers: folderHeaders(),
    });
    expect(frame.statusCode).toBe(200);
    expect(frame.json()).toEqual({
      ok: true, frame: { snapshot: SNAPSHOT, offset: 0, bytesB64: BYTES.toString('base64'), digest: FP, total: BYTES.length },
    });
    expect(t.calls).toEqual([
      ['docs-folder-read', '--label', 'notes', '--op', 'tree'],
      ['docs-folder-read', '--label', 'notes', '--op', 'show', '--section', 'specs', '--path', 'a.md', '--fingerprint', FP,
        '--max-bytes', String(docsShowPlan('a.md', undefined).maxBytes)],
      ['docs-folder-read', '--label', 'notes', '--op', 'prepare', '--section', 'specs', '--path', 'a.md', '--pin', `fp:${FP}`],
      ['docs-folder-read', '--label', 'notes', '--op', 'range', '--section', 'specs', '--path', 'a.md', '--pin', `fp:${FP}`,
        '--snapshot', SNAPSHOT, '--offset', '0', '--length', String(BYTES.length)],
    ]);
  });

  it('reads: a stat pin reaches ccd as a stat pin, a file ccd answers with another fingerprint is not served', async () => {
    const t = await open();
    const stat: DocsRangePin = { kind: 'stat', size: BYTES.length, mtimeNs: MTIME };
    const prepare = await t.app.inject({ method: 'GET', url: docsApi.folderRangePrepare('notes', 'specs', 'a.md', stat), headers: folderHeaders() });
    expect(prepare.statusCode).toBe(200);
    expect(t.calls.at(-1)!.slice(-2)).toEqual(['--pin', `stat:${BYTES.length}:${MTIME}`]);
    const other = 'd'.repeat(64);
    const file = await t.app.inject({ method: 'GET', url: docsApi.folderFile('notes', 'specs', 'a.md', other), headers: folderHeaders() });
    expect(file.statusCode, 'the show answer echoes a fingerprint that is not the one asked').toBe(502);
    expect(file.json()).toMatchObject({ ok: false, failure: 'malformed-answer', why: 'pin' });
  });
});

describe('folder doors: a folder removed while open, and a fleet without the token', () => {
  it('folder: removed while open — a tree read after the remove answers unknown-folder', async () => {
    const t = await open();
    const before = await t.app.inject({ method: 'GET', url: docsApi.folderTree('notes'), headers: folderHeaders() });
    expect(before.statusCode).toBe(200);
    const removed = await t.app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: folderHeaders() });
    expect(removed.statusCode).toBe(200);
    for (const url of [docsApi.folderTree('notes'), docsApi.folderFile('notes', 'specs', 'a.md', FP),
      docsApi.folderRangePrepare('notes', 'specs', 'a.md', PIN)]) {
      const after = await t.app.inject({ method: 'GET', url, headers: folderHeaders() });
      expect({ url, status: after.statusCode, body: after.json() }).toEqual({ url, status: 404, body: { ok: false, failure: 'unknown-folder' } });
    }
    const again = await t.app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: folderHeaders() });
    expect(again.statusCode).toBe(404);
    expect(again.json()).toEqual({ ok: false, failure: 'unknown-folder' });
  });

  it('folder doors: a fleet without docs-folders-v1 refuses every door before any exec', async () => {
    for (const verbs of [['caps', DOCS_CAP], ['caps'], [], null]) {
      const t = await open({ verbs });
      const want = verbs !== null && verbs.includes('caps') ? 'unsupported' : 'caps-unknown';
      for (const [name, url] of READ_DOORS) {
        const res = await t.app.inject({ method: 'GET', url, headers: folderHeaders() });
        expect({ verbs, name, failure: res.json().failure }).toEqual({ verbs, name, failure: want });
      }
      const del = await t.app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: folderHeaders() });
      expect({ verbs, failure: del.json().failure }).toEqual({ verbs, failure: want });
      const add = await t.app.inject({
        method: 'POST', url: docsApi.folderAdd(), headers: folderHeaders({ stepUp: true }), payload: { label: 'x', path: '/fixture/outside/x-root' },
      });
      expect(add.statusCode).toBe(501);
      expect(add.json()).toEqual({ ok: false, error: 'unsupported' });
      expect(t.calls, JSON.stringify(verbs)).toEqual([]);
    }
  });

  it('folder doors: a ccd fault and a broken answer come back as their words, redacted, with no path', async () => {
    const broken = scripted(() => okRes(line({ v: 1, verb: 'docs-folder', ok: true, elapsedMs: 1, folders: [{ label: 'A', path: 'x', state: 'ok' }] })));
    const b = await docsApp({ run: broken.run, verbs: FOLDER_VERBS, folders: { signIn: 'armed' } });
    apps.push(b.app);
    const shape = await b.app.inject({ method: 'GET', url: docsApi.folders(), headers: folderHeaders() });
    expect(shape.statusCode).toBe(502);
    expect(shape.json()).toEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
    const faulted = scripted(() => faultRes('usage: docs-folder-read --label'));
    const f = await docsApp({ run: faulted.run, verbs: FOLDER_VERBS, folders: { signIn: 'armed' } });
    apps.push(f.app);
    const fault = await f.app.inject({ method: 'GET', url: docsApi.folderTree('notes'), headers: folderHeaders() });
    expect(fault.statusCode).toBe(502);
    // The word stays; the free text (`stderrHead`) does not leave a folder door.
    expect(fault.json()).toEqual({ ok: false, failure: 'ccd-fault' });
  });
});

describe('folder doors: the absolute path leaves by one door only', () => {
  it('folder doors: the paths door is the only door whose answer, or log line, contains the fixture path', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = await open();
    const answers: [string, string][] = [];
    for (const [name, url] of READ_DOORS) {
      const res = await t.app.inject({ method: 'GET', url, headers: folderHeaders() });
      expect(res.statusCode, name).toBe(200);
      answers.push([name, res.body]);
    }
    const add = await t.app.inject({
      method: 'POST', url: docsApi.folderAdd(), headers: folderHeaders({ stepUp: true }), payload: { label: 'more', path: FOLDER_FIXTURE_PATH + '-more' },
    });
    answers.push(['add', add.body]);
    const refused = await t.app.inject({
      method: 'POST', url: docsApi.folderAdd(), headers: folderHeaders({ stepUp: true }), payload: { label: 'keys', path: FOLDER_FIXTURE_PATH + '/secret' },
    });
    answers.push(['add refusal', refused.body]);
    const del = await t.app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: folderHeaders() });
    answers.push(['remove', del.body]);
    const gone = await t.app.inject({ method: 'GET', url: docsApi.folderTree('notes'), headers: folderHeaders() });
    answers.push(['tree after remove', gone.body]);
    expect(answers.filter(([, body]) => body.includes('notes-root')).map(([name]) => name)).toEqual(['paths']);
    const logged = warn.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).not.toContain('notes-root');
  });

  it('folder doors: a ccd answer with an extra key or a free-text failure field holding the path never reaches a body', async () => {
    const P = FOLDER_FIXTURE_PATH;
    const env = { v: 1, verb: 'docs-folder-read', ok: true, elapsedMs: 3 };
    const row = { section: 'specs', path: 'a.md', kind: 'file', size: BYTES.length, mtimeNs: MTIME, fp: FP, abs: P };
    const unreadable = { section: 'plans', path: 'locked', kind: 'unreadable', size: null, mtimeNs: null, fp: null, errno: 'EACCES', abs: P };
    const answers = new Map<string, string>([
      ['tree', line({ ...env, label: 'notes', leak: P, entries: [row, unreadable], unlisted: { count: 1, byReason: { 'too-deep': 1, [P]: 2 }, abs: P } })],
      ['show', line({ ...env, label: 'notes', source: 'folder', section: 'specs', path: 'a.md', size: BYTES.length, sha256: FP, fp: FP, mtimeNs: MTIME,
        encoding: 'base64', b64: BYTES.toString('base64'), worktree: P, abs: P })],
      ['helper', failed('docs-folder-read', 'helper-failed', { detail: `Traceback at ${P}`, stderrHead: P, cause: P, word: P, extra: P })],
      ['reason', failed('docs-folder-read', 'unreadable', { reason: 'EACCES', detail: P, errno: P })],
      ['protected', failed('docs-folder-read', 'protected', { reason: P, detail: P })],
      ['errno', line({ ...env, label: 'notes', entries: [{ ...unreadable, errno: P }], unlisted: { count: 0, byReason: {} } })],
    ]);
    const mk = async (answer: string) => {
      const r = scripted(() => okRes(answer));
      const made = await docsApp({ run: r.run, verbs: FOLDER_VERBS, folders: { signIn: 'armed' } });
      apps.push(made.app);
      return made.app;
    };
    const get = async (name: string, url: string) => {
      const res = await (await mk(answers.get(name)!)).inject({ method: 'GET', url, headers: folderHeaders() });
      expect(res.body, `${name} body never carries the path`).not.toContain('notes-root');
      return res;
    };
    const tree = await get('tree', docsApi.folderTree('notes'));
    expect(tree.statusCode).toBe(200);
    expect(tree.json().tree).toEqual({
      v: 1, verb: 'docs-folder-read', ok: true, elapsedMs: 3, label: 'notes',
      entries: [
        { section: 'specs', path: 'a.md', kind: 'file', size: BYTES.length, mtimeNs: MTIME, fp: FP },
        { section: 'plans', path: 'locked', kind: 'unreadable', size: null, mtimeNs: null, fp: null, errno: 'EACCES' },
      ],
      unlisted: { count: 1, byReason: { 'too-deep': 1 } },
    });
    const show = await get('show', docsApi.folderFile('notes', 'specs', 'a.md', FP));
    expect(show.statusCode).toBe(200);
    expect(Object.keys(show.json().show).sort()).toEqual(
      ['b64', 'elapsedMs', 'encoding', 'fp', 'label', 'mtimeNs', 'ok', 'path', 'section', 'sha256', 'size', 'source', 'v', 'verb']);
    expect((await get('helper', docsApi.folderTree('notes'))).json()).toEqual({ ok: false, failure: 'helper-failed' });
    expect((await get('reason', docsApi.folderTree('notes'))).json()).toEqual({ ok: false, failure: 'unreadable', reason: 'EACCES' });
    expect((await get('protected', docsApi.folderTree('notes'))).json()).toEqual({ ok: false, failure: 'protected' });
    const bad = await get('errno', docsApi.folderTree('notes'));
    expect(bad.statusCode, 'an errno outside its grammar is a broken answer, never forwarded').toBe(502);
    expect(bad.json()).toEqual({ ok: false, failure: 'malformed-answer', why: 'schema' });
  });
});

// ===== the registration's type walls (review I2) =====
import type { DocsFolderReader } from '../src/docs/ports.js';
import {
  registerDocsFolderReadRoutes, registerDocsFolderRegistryRoutes, type DocsComposition, type DocsFolderReadDeps,
  type DocsFolderRegistryDeps, type DocsNodeLanes, type DocsNodes,
} from '../src/docs/routes.js';
import type { DocsFolderRegistry } from '../src/docs/ports.js';

/** Equal types, in either direction (the standard deferred-conditional form). */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
/** The folder READ registration takes the app, the readers, the lanes and the read deps, and nothing that can write the
 *  registry: no registry is in scope of a read handler (compiled by `typecheck-tests`, as row 49's wall is). */
type FolderReadRegistrationTakesNoRegistry = Assert<Equals<Parameters<typeof registerDocsFolderReadRoutes>,
  [FastifyInstance, DocsNodes<DocsFolderReader>, DocsNodes<DocsNodeLanes>, DocsFolderReadDeps]>>;
/** And the registry registration takes the registries, never the readers. */
type FolderRegistryRegistrationTakesNoReader = Assert<Equals<Parameters<typeof registerDocsFolderRegistryRoutes>,
  [FastifyInstance, DocsNodes<DocsFolderRegistry>, DocsNodes<DocsNodeLanes>, DocsFolderRegistryDeps]>>;

describe('folder doors: the read registration\'s type has no registry (review I2; typecheck-tests)', () => {
  it('its parameters are pinned, and a registry map cannot be passed as the readers', () => {
    const readPinned: FolderReadRegistrationTakesNoRegistry = true;
    const registryPinned: FolderRegistryRegistrationTakesNoReader = true;
    /** Never called: it exists for the compiler. Were a registry map assignable to a reader map, the directive would be
     *  unused, and `typecheck-tests` would fail on it. */
    const registryAsReader = (app: FastifyInstance, docs: DocsComposition, deps: DocsFolderReadDeps): void => {
      // @ts-expect-error -- a DocsFolderRegistry map is not a DocsFolderReader map: the read registration is never handed the registry
      registerDocsFolderReadRoutes(app, docs.folderRegistries, docs.lanes, deps);
    };
    expect(readPinned).toBe(true);
    expect(registryPinned).toBe(true);
    expect(registryAsReader).toBeTypeOf('function');
  });
});

// ===== a read begun before a write is never joined by a read begun after it (review I3) =====
import { until } from './docsRouteHelpers.js';

describe('folder doors: a write settles its generation, so a read after it makes its own exec', () => {
  /** The scripted fleet with ONE read answer held: the first call matching `hold` answers (computed at once, as ccd would
   *  have) only when `release()` is called. */
  function held(hold: (argv: string[]) => boolean) {
    const f = fleet();
    const releases: (() => void)[] = [];
    let armed = true;
    const run: typeof f.run = async (argv) => {
      const res = await f.run(argv);
      if (armed && hold([...argv])) {
        armed = false;
        await new Promise<void>((resolve) => releases.push(resolve));
      }
      return res;
    };
    return { ...f, run, releases };
  }
  const openHeld = async (h: ReturnType<typeof held>) => {
    const made = await docsApp({ run: h.run, verbs: FOLDER_VERBS, folders: { signIn: 'armed' } });
    apps.push(made.app);
    return made.app;
  };
  /** A read begun while the first is still held. A read that joined the held flight never answers until the release, so
   *  the race ends it (500 ms) as `null`, and the first is released either way, so no case leaves a request hanging. */
  const secondRead = async (app: FastifyInstance, h: ReturnType<typeof held>, url: string) => {
    const pending = app.inject({ method: 'GET', url, headers: folderHeaders() });
    const timer = new Promise<null>((resolve) => setTimeout(() => resolve(null), 500));
    const res = await Promise.race([pending, timer]);
    h.releases[0]!();
    await pending;
    return res;
  };

  it('folder: a tree read held across a Remove does not answer a tree read begun after it', async () => {
    const h = held((argv) => argv[0] === 'docs-folder-read');
    const app = await openHeld(h);
    const first = app.inject({ method: 'GET', url: docsApi.folderTree('notes'), headers: folderHeaders() });
    await until(() => h.releases.length === 1, 'the first tree read to reach the runner');
    const removed = await app.inject({ method: 'DELETE', url: docsApi.folderRemove('notes'), headers: folderHeaders() });
    expect(removed.statusCode).toBe(200);
    const before = h.calls.length;
    const second = await secondRead(app, h, docsApi.folderTree('notes'));
    expect(h.calls.length, 'the second read made its own exec: it did not join the first read\'s flight').toBe(before + 1);
    expect(second, 'the second read answered while the first was held').not.toBeNull();
    expect(second!.statusCode).toBe(404);
    expect(second!.json()).toEqual({ ok: false, failure: 'unknown-folder' });
    expect((await first).statusCode).toBe(200);
  });

  it('folder: a listing held across an Add does not answer a listing begun after it', async () => {
    const h = held((argv) => argv[0] === 'docs-folder' && argv[1] === '--list');
    const app = await openHeld(h);
    const first = app.inject({ method: 'GET', url: docsApi.folders(), headers: folderHeaders() });
    await until(() => h.releases.length === 1, 'the first listing to reach the runner');
    const added = await app.inject({
      method: 'POST', url: docsApi.folderAdd(), headers: folderHeaders({ stepUp: true }), payload: { label: 'extra', path: '/fixture/outside/extra-root' },
    });
    expect(added.statusCode).toBe(200);
    const before = h.calls.length;
    const second = await secondRead(app, h, docsApi.folders());
    expect(h.calls.length, 'the second listing made its own exec').toBe(before + 1);
    expect(second, 'the second listing answered while the first was held').not.toBeNull();
    expect(second!.json().folders.map((r: { label: string }) => r.label)).toEqual(['notes', 'team-a', 'extra']);
    expect((await first).json().folders.map((r: { label: string }) => r.label)).toEqual(['notes', 'team-a']);
  });

  it('folder: a write that ccd refuses settles the generation too', async () => {
    const h = held((argv) => argv[0] === 'docs-folder-read');
    const app = await openHeld(h);
    const first = app.inject({ method: 'GET', url: docsApi.folderTree('notes'), headers: folderHeaders() });
    await until(() => h.releases.length === 1, 'the first tree read to reach the runner');
    const refused = await app.inject({
      method: 'POST', url: docsApi.folderAdd(), headers: folderHeaders({ stepUp: true }), payload: { label: 'notes', path: '/fixture/outside/other-root' },
    });
    expect(refused.statusCode).toBe(409);
    const before = h.calls.length;
    const second = await secondRead(app, h, docsApi.folderTree('notes'));
    expect(h.calls.length, 'a refused write also moved the generation').toBe(before + 1);
    expect(second).not.toBeNull();
    await first;
  });
});
