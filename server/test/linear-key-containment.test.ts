// THE CONTAINMENT CENSUS (#1444, spec §13.5, §14 row 12; plan task LK9 and its build notes): a key goes from its
// `.key` file to `callLinear`'s `authorization` header and nowhere else, and its digest sits only in a record's
// `keyDigest` field. Every proxy route is driven through every arm this rig can produce, and so are the other paths
// that use a key: the legacy Check again, the background refresher (its queue driven by a direct call), and
// `resolveTitle` through the preview route and directly as the workspace create and the rename call it. Everything a
// key could leak into is captured: each response's body and headers, every `console` method, both standard streams,
// every `linear_events` row, and every file in `~/.ccrc/linear/` plus `linear.json`, each record parsed as the store
// parses it. The key may appear only in a `.key` file and the outbound header (neither is captured here); no
// eight-character run of it may appear anywhere captured; its digest only at `keyDigest`.
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseLinearStoreRecord } from '../../shared/linear.js';
import { parseLinearRef } from '../../shared/slug.js';
import { parseLinearDetails } from '../src/linear/connection.js';
import { LINEAR_VERBS, type LinearVerb } from '../src/linear/ops.js';
import { resolveTitle } from '../src/linear/resolve.js';
import { parseLegacyTeams, readLinearStore } from '../src/linear/store.js';
import { valueDigestHex } from '../src/token/files.js';
import { RATELIMITED_ERRORS } from './linearFetchFake.js';
import {
  IDS, PROXY_TOKEN, WS, proxyRig, seedLegacy, seedSlot, statusAnswer, who, type ProxyRig, type Responder,
} from './linearProxyRig.js';

/** The arm the stand-in answers every Linear call with, set before each drive. */
type Arm = 'ok' | '401' | '403' | '429' | 'ratelimited-200' | '500' | 'timeout' | 'malformed' | 'errors' | 'empty';
let arm: Arm = 'ok';
const respond: Responder = (c) => {
  switch (arm) {
    case 'ok': return null;
    case '401': return statusAnswer(401, {}, { errors: [{ message: 'canary authentication refused' }] });
    case '403': return statusAnswer(403);
    case '429': return statusAnswer(429, { 'retry-after': '2' });
    case 'ratelimited-200': return { body: RATELIMITED_ERRORS };
    case '500': return statusAnswer(500);
    case 'timeout': return c.op === 'KeyCheck' || c.op.startsWith('Directory') ? statusAnswer(500) : new Promise(() => {});
    case 'malformed': return { body: { data: { nothing: true } } };
    case 'errors': return { body: { errors: [{ message: 'canary', extensions: { code: 'SOMETHING' } }] } };
    case 'empty': return { body: { data: { issue: null, parent: null } } };
  }
};
const ARMS: readonly Arm[] = ['ok', '401', '403', '429', 'ratelimited-200', '500', 'timeout', 'malformed', 'errors', 'empty'];

/** Everything captured, labelled by where it came from. */
const captured: { where: string; text: string }[] = [];
const capture = (where: string, text: string): void => { captured.push({ where, text }); };

/** Every record file as it stood after each drive (a record a later write cleans up still counts), by file. */
const snapshots: { where: string; file: string; raw: string }[] = [];
const snapshot = (where: string): void => {
  const dir = path.join(rig.ccrcDir, 'linear');
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!f.endsWith('.key')) snapshots.push({ where, file: f, raw: readFileSync(path.join(dir, f), 'utf8') });
  }
  const legacy = path.join(rig.ccrcDir, 'linear.json');
  if (existsSync(legacy)) snapshots.push({ where, file: 'linear.json', raw: readFileSync(legacy, 'utf8') });
};

let rig: ProxyRig;
let legacyKey = '';
/** The services' clock, moved past each bucket's window between calls so the buckets never stop the drive (their
 *  own rows are `linear-rate.test.ts`'s), and past any closed slot between arms. */
let t = 1_800_000_000_000;
const clock = (): number => t;
const keys = (): string[] => [WS.a.key, legacyKey];

const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
const restores: (() => void)[] = [];

beforeAll(async () => {
  for (const m of CONSOLE) {
    const spy = vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { capture(`console.${m}`, args.map((a) => (a instanceof Error ? `${a.name} ${a.message} ${a.stack ?? ''}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); });
    restores.push(() => spy.mockRestore());
  }
  for (const [name, stream] of [['stdout', process.stdout], ['stderr', process.stderr]] as const) {
    const orig = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      capture(name, typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
    restores.push(() => { stream.write = orig as typeof stream.write; });
  }
  rig = await proxyRig({ respond, timeoutMs: 20, clock });
  legacyKey = await seedLegacy(rig.ccrcDir, 'b', { learned: true });
  await seedSlot(rig.ccrcDir, 'a');
}, 60_000);

afterAll(async () => {
  for (const r of restores.reverse()) r();
  await rig?.close();
});

const BODY: Readonly<Partial<Record<LinearVerb, unknown>>> = {
  search: { team: 'AAA', text: `find lin_api_fixturePastedSecretQ1w2e3r4t5y6u7i8o9p0` },
  create: { team: 'AAA', title: 'A title', description: 'see lin_api_fixturePastedSecretQ1w2e3r4t5y6u7i8o9p0', labels: ['Bug'], parent: 'AAA-9' },
  update: { title: 'A new title', state: 'Todo', parent: 'AAA-9' },
  comment: { body: 'A comment' },
};

/** One proxy call, everything it answered captured. */
async function drive(label: string, verb: LinearVerb, o: Parameters<ProxyRig['call']>[1] = {}): Promise<void> {
  t += 61_000;
  const res = await rig.call(verb, { body: BODY[verb], ...o });
  capture(`${label} ${verb} body`, res.body);
  capture(`${label} ${verb} headers`, JSON.stringify(res.headers));
  snapshot(`${label} ${verb}`);
}

/** Every eight-character run of `key`. */
const runsOf = (key: string): string[] => Array.from({ length: key.length - 7 }, (_, i) => key.slice(i, i + 8));

describe('the census drives every path that uses a key, through every arm', () => {
  it('every proxy route, through every Linear arm, against the file slot and the learned legacy slot', async () => {
    // `ok` twice: the first fills the directory in the background, so the second, and every failure arm after it,
    // sends its mutations too.
    for (const a of ['ok', ...ARMS] as const) {
      arm = a;
      t += 7_200_000;
      for (const verb of LINEAR_VERBS) {
        await drive(`arm ${a}`, verb, { ref: 'AAA-12' });
        await drive(`arm ${a} legacy`, verb, { ref: 'BBB-12', query: verb === 'teams' || verb === 'statuses' || verb === 'projects' || verb === 'labels' || verb === 'users' ? { workspace: 'ws-b' } : {},
          body: verb === 'search' || verb === 'create' ? { ...(BODY[verb] as Record<string, unknown>), team: 'BBB', ...(verb === 'create' ? { parent: 'BBB-9' } : {}) } : BODY[verb] });
      }
      await rig.fx.refresher.idle();
    }
    expect(rig.calls.length, 'the drive reached Linear').toBeGreaterThan(150);
  }, 120_000);

  it('every refusal before Linear: the token, attribution, the validator, routing, names', async () => {
    arm = 'ok';
    for (const verb of LINEAR_VERBS) {
      await drive('no token', verb, { token: null });
      await drive('wrong token', verb, { token: PROXY_TOKEN.replace(/e$/, 'f') });
      await drive('unknown sender', verb, { as: who('project-a-no-such') });
      await drive('stale uuid', verb, { as: { id: 'project-a-calm-mesa', uuid: 'u-other' } });
      await drive('no identity', verb, { as: null });
      await drive('team miss', verb, { ref: 'ZZZ-1', query: { workspace: 'ws-z' } });
      await drive('bad field', verb, { body: { nope: 1 } });
    }
    await drive('name miss', 'create', { body: { team: 'AAA', title: 'T', labels: ['No such label'] } });
    await rig.fx.refresher.idle();
  });

  it('the legacy Check again, through every arm', async () => {
    for (const a of ARMS) {
      arm = a;
      const res = await rig.app.inject({ method: 'POST', url: '/api/linear/connection/check' });
      capture(`check ${a} body`, res.body);
      capture(`check ${a} headers`, JSON.stringify(res.headers));
      const view = await rig.app.inject({ method: 'GET', url: '/api/linear/connection' });
      capture(`connection ${a}`, view.body);
      snapshot(`check ${a}`);
    }
  });

  it('the background refresher (teams and directory), by a direct call, through every arm', async () => {
    for (const a of ARMS) {
      arm = a;
      const store = await readLinearStore(rig.ccrcDir);
      if (store.kind !== 'listed') throw new Error('store unreadable');
      rig.fx.refresher.queueDirectory({ source: 'file', id: WS.a.id });
      rig.fx.refresher.queueDirectory({ source: 'legacy' });
      rig.fx.refresher.miss(store);
      await rig.fx.refresher.idle();
      snapshot(`refresh ${a}`);
    }
  });

  it('resolveTitle: the preview route, and the two direct callers in server.ts (the create and the rename)', async () => {
    for (const a of ARMS) {
      arm = a;
      for (const ref of ['AAA-12', 'BBB-12', 'ZZZ-1']) {
        const res = await rig.app.inject({ method: 'GET', url: `/api/linear/resolve?ref=${ref}` });
        capture(`preview ${a} ${ref}`, `${res.body} ${JSON.stringify(res.headers)}`);
        for (const caller of ['create', 'rename']) {
          const t = await resolveTitle(ref, parseLinearRef(ref), {
            ccrcDir: rig.ccrcDir, rate: rig.fx.rate, fetch: rig.fetch, timeoutMs: 20,
          }).catch((e: unknown) => ({ threw: String(e) }));
          capture(`${caller} ${a} ${ref}`, JSON.stringify(t));
          snapshot(`${caller} ${a} ${ref}`);
        }
      }
    }
  });
});

describe('what the census found', () => {
  it('no key, and no eight-character run of one, in any response, log line, stream write or journal row', () => {
    const rows = rig.rows();
    expect(rows.length, 'the drive wrote no journal row: the census is over nothing').toBeGreaterThan(5);
    const corpus = [...captured, ...rows.map((r) => ({ where: `linear_events ${String(r['id'])}`, text: JSON.stringify(r) }))];
    expect(captured.some((c) => c.where.startsWith('console.')), 'no console line was captured: the spy is not live').toBe(true);
    for (const key of keys()) {
      expect(key.length).toBeGreaterThan(30);
      const runs = runsOf(key);
      const hits = corpus.filter((c) => runs.some((r) => c.text.includes(r)));
      expect(hits.map((h) => h.where), `a run of a key reached ${hits[0]?.where}`).toEqual([]);
    }
  });

  it('no digest in any response, log line, stream write or journal row', () => {
    const corpus = [...captured, ...rig.rows().map((r) => ({ where: 'linear_events', text: JSON.stringify(r) }))];
    for (const key of keys()) {
      const d = valueDigestHex(key);
      const hits = corpus.filter((c) => c.text.includes(d) || c.text.includes(d.slice(0, 16)));
      expect(hits.map((h) => h.where)).toEqual([]);
    }
  });

  it('every record, after every drive, parses as the store parses it and holds its digest at keyDigest and nowhere else', () => {
    snapshot('the end');
    expect(snapshots.filter((x) => /^[0-9a-f-]{36}\.json$/.test(x.file)).length, 'no slot record was seen: the census is over nothing').toBeGreaterThan(50);
    expect(snapshots.some((x) => x.file === 'legacy-teams.json')).toBe(true);
    expect(snapshots.some((x) => x.file === 'linear.json')).toBe(true);
    const parse = (file: string, raw: string): unknown => (file === 'legacy-teams.json' ? parseLegacyTeams(raw)
      : file === 'linear.json' ? parseLinearDetails(raw)
        : /^[0-9a-f-]{36}\.json$/.test(file) ? parseLinearStoreRecord(raw) : null);
    for (const { where, file, raw } of snapshots) {
      const parsed = parse(file, raw);
      expect(parsed, `${file} after ${where} does not parse as the store reads it (or is a file no store writes)`).not.toBeNull();
      const { keyDigest, ...rest } = parsed as Record<string, unknown>;
      expect(typeof keyDigest, `${file} after ${where}`).toBe('string');
      for (const key of keys()) {
        const d = valueDigestHex(key);
        expect(JSON.stringify(rest).includes(d), `${file} after ${where} holds a digest outside keyDigest`).toBe(false);
        if (raw.includes(d)) expect(raw.split(d).length - 1, `${file} after ${where} holds the digest twice`).toBe(1);
        for (const r of runsOf(key)) expect(raw.includes(r), `${file} after ${where} holds a run of a key`).toBe(false);
      }
    }
  });

  it('the drive reached every document: each read, each resolve, each mutation, the key check and the directory', () => {
    const ops = new Set(rig.calls.map((c) => c.op));
    for (const op of ['Issue', 'Search', 'Comments', 'Statuses', 'Projects', 'Labels', 'Users', 'IssueCreate', 'IssueUpdate',
      'CommentCreate', 'ResolveIssueAndParent', 'ResolveIssue', 'ResolveParent', 'KeyCheck', 'DirectoryStates', 'DirectoryLabels',
      'DirectoryProjects', 'DirectoryUsers']) expect(ops.has(op), `the census never sent ${op}`).toBe(true);
    // Every key was used, through the header the stand-in saw (the one allowed place besides its file).
    for (const key of keys()) expect(rig.calls.some((c) => c.authorization === key), 'a key the census guards was never used').toBe(true);
  });

  it('the census saw the slots it drove: the file slot and the legacy slot\'s teams file', () => {
    const dir = path.join(rig.ccrcDir, 'linear');
    expect(existsSync(path.join(dir, `${WS.a.id}.json`))).toBe(true);
    expect(existsSync(path.join(dir, 'legacy-teams.json'))).toBe(true);
    expect(IDS.issue).toMatch(/^[0-9a-f-]{36}$/);
  });
});
