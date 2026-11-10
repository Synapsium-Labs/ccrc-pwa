// The limit watchdog's "no room" record and the wait door reach the server (D-8123, limit-swap-autofix Task 10).
//
// `$REG/<id>.limitwait` (written by ccd's `_limitwait_open`, one line: `state=open since=<epoch> reset=<epoch|-> account=<w>
// sign=<sign>[ choice=wait at=<epoch>]`) is the Waiting on you item's source. The registry read gives it the
// three-valued shape `.stranded` has: an item, none, or LISTED BUT UNREADABLE (not an item, not cached). It reaches the
// frame as `FleetSession.limitWait` (epoch MS, like `stranded.at`; `null` with none, and an older server's frame that
// lacks the key reads `null`), and `POST /api/sessions/:id/limit-wait` is the operator's "Wait until reset": session-gated
// like the swap route, one `ccd limit-wait <id>`, `{ok: true}` or the refusal word.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { localIO, type FleetIO } from '../src/io.js';
import { isCleanRecord, limitWaitOf, readSessionRecord, type SessionRecord } from '../src/registry.js';
import { assembleFleet } from '../src/fleet.js';
import { liveStateReaderOver } from '../src/livestate.js';
import { Tmux, type Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { CCD_ARGV } from '../src/ccdargv.js';
import { reviveFleetSession } from '../../shared/api.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'lane-a-project-a';
const OPEN = 'state=open since=1784500000 reset=1784590000 account=lane-a sign=menu';
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-limit-wait-read-');
  seedRoster(home);
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'project-a', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const cfg = () => loadConfig({ CCRC_HOME: home });
const field = (f: string, v: string): void => writeFileSync(path.join(reg, `${ID}.${f}`), v);
const record = async (io: FleetIO = localIO): Promise<SessionRecord> => {
  const r = await readSessionRecord(io, cfg(), ID);
  if (r.kind !== 'found') throw new Error(`fixture row not found: ${r.kind}`);
  return r.record;
};

describe('limitWaitOf reads the one line, strictly', () => {
  it('an open record gives its since, reset, account and whether the operator chose to wait', () => {
    expect(limitWaitOf({ ok: true, content: OPEN })).toEqual({ since: 1784500000, reset: 1784590000, account: 'lane-a', waiting: false });
    expect(limitWaitOf({ ok: true, content: `${OPEN} choice=wait at=1784500100` }))
      .toEqual({ since: 1784500000, reset: 1784590000, account: 'lane-a', waiting: true });    // D-8173 ruling (a): ccd's own choice where no account has room reads the same.
    expect(limitWaitOf({ ok: true, content: `${OPEN} choice=wait at=1784500100 by=auto` }))
      .toEqual({ since: 1784500000, reset: 1784590000, account: 'lane-a', waiting: true });
  });
  it('a reset of `-` is null', () => {
    expect(limitWaitOf({ ok: true, content: 'state=open since=1784500000 reset=- account=lane-a sign=pane' }))
      .toEqual({ since: 1784500000, reset: null, account: 'lane-a', waiting: false });
  });
  it('a trailing newline is the file\'s own', () => {
    expect(limitWaitOf({ ok: true, content: `${OPEN}\n` })).toMatchObject({ account: 'lane-a' });
  });
  it('a closed record, an unlisted file and an empty one read null', () => {
    expect(limitWaitOf({ ok: true, content: `${OPEN.replace('state=open', 'state=closed')} end=swap until=1784500500` })).toBeNull();
    expect(limitWaitOf(null)).toBeNull();
    expect(limitWaitOf({ ok: true, content: '' })).toBeNull();
  });
  it.each([
    ['a torn line', 'state=open since=178450'],
    ['a hostile since', 'state=open since=$(touch x) reset=- account=lane-a sign=menu'],
    ['an unknown sign', 'state=open since=1784500000 reset=- account=lane-a sign=hunch'],
    ['an account with a space', 'state=open since=1784500000 reset=- account=lane a sign=menu'],
    ['a stray word', `${OPEN} surprise=1`],
    ['a choice other than wait', `${OPEN} choice=swap at=1784500100`],
    ['a choice with no time', `${OPEN} choice=wait`],
    ['a chooser other than auto', `${OPEN} choice=wait at=1784500100 by=operator`],
    ['by=auto with no choice', `${OPEN} by=auto`],
    ['two lines', `${OPEN}\n${OPEN}`],
  ])('%s reads null, never evaluated', (_n, content) => {
    expect(limitWaitOf({ ok: true, content })).toBeNull();
  });
  it('a listed file whose bytes did not come back is `unreadable`, not none', () => {
    expect(limitWaitOf({ ok: false, reason: 'unreadable' })).toBe('unreadable');
  });
  it('a listed file that vanished before the read is no record', () => {
    expect(limitWaitOf({ ok: false, reason: 'absent' })).toBeNull();
  });
});

describe('the registry record carries it', () => {
  it('a row with no file carries no field; an open record carries it', async () => {
    expect((await record()).limitWait).toBeUndefined();
    field('limitwait', OPEN);
    expect((await record()).limitWait).toEqual({ since: 1784500000, reset: 1784590000, account: 'lane-a', waiting: false });
    field('limitwait', `${OPEN} choice=wait at=1784500100`);
    expect((await record()).limitWait).toMatchObject({ waiting: true });
  });

  it('a closed or malformed record carries null (a measured none), and the row stays clean', async () => {
    field('limitwait', `${OPEN.replace('state=open', 'state=closed')} end=clear until=1784500500`);
    expect((await record()).limitWait).toBeNull();
    field('limitwait', 'garbage');
    expect((await record()).limitWait).toBeNull();
    expect(isCleanRecord(await record())).toBe(true);
  });

  it('a listed record that will not read is `unreadable` and the row is not clean (never cached)', async () => {
    field('limitwait', OPEN);
    const unreadable: FleetIO = {
      ...localIO,
      readFileMeasured: async (p: string, t?: number, sig?: AbortSignal) =>
        (p.endsWith('.limitwait') ? { ok: false, reason: 'unreadable' } as const : localIO.readFileMeasured(p, t, sig)),
    };
    const rec = await record(unreadable);
    expect(rec.limitWait).toBe('unreadable');
    expect(isCleanRecord(rec)).toBe(false);
  });

  it('a row without the file costs no read of it', async () => {
    const seen: string[] = [];
    const counting: FleetIO = {
      ...localIO,
      readFileMeasured: async (p: string, t?: number, sig?: AbortSignal) => { seen.push(path.basename(p)); return localIO.readFileMeasured(p, t, sig); },
    };
    await record(counting);
    expect(seen.filter((n) => n.endsWith('.limitwait'))).toEqual([]);
  });
});

describe('the fleet frame carries it', () => {
  const noopRun: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
  const fleet = () => assembleFleet(localIO, cfg(), new Tmux(noopRun), liveStateReaderOver(localIO), 1784600000);

  it('null with no record; an open record as epoch MS with `waiting`; a closed one null again', async () => {
    expect((await fleet()).find((s) => s.id === ID)?.limitWait).toBeNull();
    field('limitwait', OPEN);
    expect((await fleet()).find((s) => s.id === ID)?.limitWait)
      .toEqual({ since: 1784500000_000, reset: 1784590000_000, account: 'lane-a', waiting: false });
    field('limitwait', `${OPEN} choice=wait at=1784500100`);
    expect((await fleet()).find((s) => s.id === ID)?.limitWait).toMatchObject({ waiting: true });
    field('limitwait', `${OPEN.replace('state=open', 'state=closed')} end=swap until=1784500500`);
    expect((await fleet()).find((s) => s.id === ID)?.limitWait).toBeNull();
  });

  it('an unknown reset travels as null, not 0', async () => {
    field('limitwait', 'state=open since=1784500000 reset=- account=lane-a sign=account');
    expect((await fleet()).find((s) => s.id === ID)?.limitWait?.reset).toBeNull();
  });

  it('a revived frame keeps it; an older server\'s frame without the key reads null; a malformed one reads null', async () => {
    field('limitwait', OPEN);
    const s = (await fleet()).find((x) => x.id === ID)!;
    const wire = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
    expect(reviveFleetSession(wire)?.limitWait).toEqual(s.limitWait);
    const { limitWait: _drop, ...older } = wire;
    expect(reviveFleetSession(older)?.limitWait).toBeNull();
    expect(reviveFleetSession({ ...wire, limitWait: { since: 'x' } })?.limitWait).toBeNull();
    expect(reviveFleetSession({ ...wire, limitWait: 'waiting' })?.limitWait).toBeNull();
  });
});

describe('POST /api/sessions/:id/limit-wait', () => {
  const caps = (verbs: string[]) => ({ connected: true, downSince: null, ccdVerbs: verbs, rosterFp: null, build: null });
  let app: FastifyInstance | null = null;
  afterEach(async () => { await app?.close(); app = null; });
  const open = async (verbs: string[] | null, ccd: { code: number; stderr: string } = { code: 0, stderr: '' }) => {
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      return args[0] === 'limit-wait'
        ? { ran: true, code: ccd.code, stdout: '', stderr: ccd.stderr }
        : { ran: true, code: 0, stdout: '', stderr: '' };
    };
    app = await buildServer({ ...testDeps(home, run), ...(verbs === null ? {} : { fleetState: caps(verbs) }) });
    await app.ready();
    return { calls, ccd: () => calls.filter((c) => c[0] === 'limit-wait') };
  };
  const post = (id = ID) => app!.inject({ method: 'POST', url: `/api/sessions/${id}/limit-wait` });

  it('the argv is exactly `limit-wait <id>`', () => {
    expect([...CCD_ARGV.limitWait(ID)]).toEqual(['limit-wait', ID]);
  });

  it('a known session on a box that lists the verb: 200 {ok: true}, one ccd call', async () => {
    const b = await open(['limit-wait']);
    const res = await post();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(b.ccd()).toEqual([['limit-wait', ID]]);
  });

  it('ccd\'s `not-waiting` refusal is a 409 with that word, and nothing else is sent', async () => {
    const b = await open(['limit-wait'], { code: 1, stderr: 'ccd: not-waiting: lane-a-project-a has no open limit-wait record (it moved, or its limit cleared)\n' });
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-waiting' });
    expect(b.ccd()).toHaveLength(1);
  });

  it('any other ccd failure is the generic 502 with ccd\'s sentence', async () => {
    await open(['limit-wait'], { code: 1, stderr: 'ccd: limit-wait: could not record the choice for lane-a-project-a\n' });
    const res = await post();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, stderr: expect.stringContaining('could not record') });
  });

  it('a box whose ccd does not list the verb answers 501 unsupported and is sent nothing', async () => {
    const b = await open(['hibernate']);
    const res = await post();
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(b.ccd()).toEqual([]);
  });

  it('an unknown session is 404, a malformed id 400, and ccd is never called', async () => {
    const b = await open(['limit-wait']);
    const missing = await post('lane-a-nothing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ ok: false, error: 'unknown-session' });
    const bad = await post('..%2Fetc');
    expect(bad.statusCode).toBe(400);
    expect(b.ccd()).toEqual([]);
  });
});
