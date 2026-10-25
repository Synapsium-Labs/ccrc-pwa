import { describe, it, expect } from 'vitest';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { parseSkillListing, BUILTINS } from '../src/commands.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { mkTmp } from './tmpHelpers.js';
import { seedRoster, testDeps } from './helpers.js';
import { seedRow } from './idGateFixture.js';
import { countingIO } from './countingIO.js';
import { READ_FROM_MAX_BYTES } from '../../shared/agent-protocol.js';

describe('parseSkillListing', () => {
  it('parses "- name: desc" lines, keeping plugin:skill names', () => {
    const content = [
      '- superpowers:brainstorming: You MUST use this before any creative work.',
      '- vastai: Use when renting GPUs.',
      '  (not a skill line — indented note)',
      '- handoff: Hand off a bounded task to a cheap worker.',
    ].join('\n');
    const skills = parseSkillListing(content);
    expect(skills.map((s) => s.name)).toEqual(['superpowers:brainstorming', 'vastai', 'handoff']);
    expect(skills[0]).toEqual({ name: 'superpowers:brainstorming', desc: 'You MUST use this before any creative work.', kind: 'skill' });
  });
});

describe('GET /api/sessions/:id/commands', () => {
  it('returns builtins + skills parsed from the session transcript', async () => {
    const home = mkTmp('ccrc-cmd-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const id = 'claude-a-project-j';
    const workdir = '/data/projects/project-j';
    const uuid = '9'.repeat(36);
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'project-j', workdir, uuid, started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    const munged = workdir.replace(/[/._]/g, '-');
    const tdir = path.join(home, '.claude-a', 'projects', munged);
    mkdirSync(tdir, { recursive: true });
    const skillListing = { attachment: { type: 'skill_listing', content: '- superpowers:writing-plans: Use when you have a spec.\n- graphify: Turn input into a graph.' } };
    writeFileSync(path.join(tdir, `${uuid}.jsonl`), JSON.stringify(skillListing) + '\n');

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { ran: true, code: 1, stdout: '', stderr: '' }; // dead → uses registry workdir
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}/commands` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { builtins: { name: string }[]; skills: { name: string }[] };
    expect(body.builtins.map((c) => c.name).slice(0, 3)).toEqual(['compact', 'effort', 'model']);
    expect(body.builtins.length).toBe(BUILTINS.length);
    expect(body.skills.map((c) => c.name)).toEqual(['superpowers:writing-plans', 'graphify']);
    await app.close();
  });

  // Fix round 1, Important #2: the §5.2 asymmetry had no test at all — a
  // mutation adding `foreign` to this route's `resolveTranscript` call left
  // this whole file green. A derived skill listing silently taken from
  // another account's frozen transcript is exactly the quiet wrongness the
  // spec removes, and this route has no banner surface to warn about it (only
  // the session stream does) — so it must never even LOOK at another account.
  it('never reads a foreign account\'s transcript — a stray uuid match under another account yields NO skills', async () => {
    const home = mkTmp('ccrc-cmd-foreign-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const id = 'claude-a-project-j';
    const workdir = '/data/projects/project-j';
    const uuid = '8'.repeat(36);
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'project-j', workdir, uuid, started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    // Own account (claude-a): the projects root exists but holds nothing for
    // this uuid — a genuine, COMPLETE miss, not an unmeasurable one.
    mkdirSync(path.join(home, '.claude-a', 'projects'), { recursive: true });
    // A DIFFERENT account (claude-b) holds a transcript for the SAME uuid,
    // with a real skill listing — findable only via rung 6 (foreign glob).
    const foreignDir = path.join(home, '.claude-b', 'projects', '-stranded');
    mkdirSync(foreignDir, { recursive: true });
    const skillListing = { attachment: { type: 'skill_listing', content: '- graphify: Turn input into a graph.' } };
    writeFileSync(path.join(foreignDir, `${uuid}.jsonl`), JSON.stringify(skillListing) + '\n');

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { ran: true, code: 1, stdout: '', stderr: '' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}/commands` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: { name: string }[] };
    expect(body.skills).toEqual([]);
    await app.close();
  });

  // Minor (fix round 1): `registryWorkdir` was unpinned — nothing distinguished
  // it from the live `cwd`. Rung 5 (the own-account uuid glob) is a catch-all
  // that finds a transcript ANYWHERE under `<configDir>/projects/`, so a naive
  // fixture with only one candidate on disk can't tell `registryWorkdir:
  // rec.workdir` apart from `registryWorkdir: cwd` — both eventually reach the
  // same file via the glob. The distinguishing case needs TWO candidates: the
  // CORRECT one at the exact registry-workdir address (rungs 3-4, checked
  // BEFORE any glob and returned immediately, regardless of mtime) and a
  // DECOY elsewhere with a newer mtime that only `pickNewest`'s glob fallback
  // would ever prefer. A live session whose pane cwd has moved (e.g. into a
  // worktree, with no transcript at that address at all) forces rungs 1-2 to
  // miss, isolating exactly the rung-3-4-vs-rung-5 question the pin protects.
  it('a live session whose cwd moved still prefers the REGISTRY workdir\'s exact transcript (rungs 3-4) ' +
     'over a newer decoy elsewhere that only the glob fallback would pick', async () => {
    const home = mkTmp('ccrc-cmd-pin-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const id = 'claude-a-project-j-pin';
    const registryWorkdir = '/data/projects/project-j';
    const liveCwd = '/data/projects/project-j-worktree'; // moved — e.g. into a worktree
    const uuid = '7'.repeat(36);
    const pid = 5551;
    for (const [k, v] of Object.entries(
      { wrapper: 'claude-a', project: 'project-j', workdir: registryWorkdir, uuid, started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    const cfgDir = path.join(home, '.claude-a');
    mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
    writeFileSync(path.join(cfgDir, 'sessions', `${pid}.json`), JSON.stringify({
      pid, sessionId: uuid, cwd: liveCwd, name: 'project-j', status: 'idle', statusUpdatedAt: 1, version: '2.1.210',
    }));
    // The CORRECT copy, at the REGISTRY workdir's exact munge — planted FIRST
    // (older mtime), so only an exact-rung hit (not `pickNewest`) can prefer it.
    const munged = registryWorkdir.replace(/[/._]/g, '-');
    const tdir = path.join(cfgDir, 'projects', munged);
    mkdirSync(tdir, { recursive: true });
    const correctListing = { attachment: { type: 'skill_listing', content: '- graphify: Turn input into a graph.' } };
    writeFileSync(path.join(tdir, `${uuid}.jsonl`), JSON.stringify(correctListing) + '\n');
    // A DECOY under some unrelated project dir — same uuid, reachable only via
    // rung 5's glob. Its mtime is forced explicitly (not just "written
    // second") to a full minute newer, so `pickNewest`'s mtime comparison is
    // unambiguous and this test cannot flake on filesystem timestamp
    // resolution — and its path is chosen to sort BEFORE the correct one
    // (`-elsewhere...` < `-data...` is false; picked `-aaa...` instead) so a
    // reversion to path-based tie-breaking would ALSO wrongly prefer it,
    // closing both ways `pickNewest` could accidentally still favor the
    // correct file for the wrong reason.
    const decoyDir = path.join(cfgDir, 'projects', '-aaa-elsewhere-stale-copy');
    mkdirSync(decoyDir, { recursive: true });
    const decoyListing = { attachment: { type: 'skill_listing', content: '- vastai: Rent GPUs.' } };
    const decoyFile = path.join(decoyDir, `${uuid}.jsonl`);
    writeFileSync(decoyFile, JSON.stringify(decoyListing) + '\n');
    const future = new Date(Date.now() + 60_000);
    utimesSync(decoyFile, future, future);

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { ran: true, code: 0, stdout: '', stderr: '' };  // LIVE
      if (args[0] === 'list-panes') return { ran: true, code: 0, stdout: `${pid}\n`, stderr: '' };
      return { ran: true, code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}/commands` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: { name: string }[] };
    expect(body.skills.map((s) => s.name)).toEqual(['graphify']);  // exact rung, not the newer decoy
    await app.close();
  });

  // Claude Code trims descriptions under its budget (D-6434, bare-name-skill-lines): measured, 86 of 723 recorded
  // listings carry bare `- name` lines, one listing with 48 names of which the described-only rule parsed 10.
  it('a listing that mixes described and bare names lists every skill, the bare ones with no description', async () => {
    const home = mkTmp('ccrc-cmd-bare-');
    seedRoster(home);
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const id = 'claude-a-project-j-bare';
    const workdir = '/data/projects/project-j';
    const uuid = '6'.repeat(36);
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'project-j', workdir, uuid, started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    const tdir = path.join(home, '.claude-a', 'projects', workdir.replace(/[/._]/g, '-'));
    mkdirSync(tdir, { recursive: true });
    const content = [
      '- plugin-a:skill-b: Described skill.',
      '- skill-a',
      '- skill-c: Another described skill.',
      '- plugin-a:skill-d',
      '- **Note**',
      '  (an indented note, not a skill)',
      'Prose that is neither shape.',
      '- skill-e: Last described skill.',
    ].join('\n');
    writeFileSync(path.join(tdir, `${uuid}.jsonl`), JSON.stringify({ attachment: { type: 'skill_listing', isInitial: true, content } }) + '\n');
    const run: Runner = async () => ({ ran: true, code: 1, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}/commands` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { skills: unknown[] }).skills).toEqual([
      { name: 'plugin-a:skill-b', desc: 'Described skill.', kind: 'skill' },
      { name: 'skill-a', desc: '', kind: 'skill' },
      { name: 'skill-c', desc: 'Another described skill.', kind: 'skill' },
      { name: 'plugin-a:skill-d', desc: '', kind: 'skill' },
      { name: 'skill-e', desc: 'Last described skill.', kind: 'skill' },
    ]);
    await app.close();
  });

  it('unknown session id returns 404', async () => {
    const home = mkTmp('ccrc-cmd-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const run: Runner = async () => ({ ran: true, code: 0, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nope/commands' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/sessions/:id/commands reads one registry row (D-6434)', () => {
  /** A fixture HOME of `rows` registry rows (the target plus `rows - 1` others); the IO calls one request makes. */
  async function callsFor(rows: number): Promise<Record<string, number>> {
    const home = mkTmp('ccrc-cmd-rows-');
    for (let i = 0; i < rows - 1; i++) seedRow(home, `project-a-other-${i}`);
    const id = 'project-a-ws-a';
    const uuid = '9'.repeat(36);
    const workdir = '/data/projects/project-a';
    seedRow(home, id, { wrapper: 'claude', uuid, workdir });
    const tdir = path.join(home, '.claude', 'projects', workdir.replace(/[/._]/g, '-'));
    mkdirSync(tdir, { recursive: true });
    writeFileSync(path.join(tdir, `${uuid}.jsonl`), JSON.stringify({ attachment: { type: 'skill_listing', content: '- a: b' } }) + '\n');
    const c = countingIO();
    const app = await buildServer({ ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), io: c.io });
    c.reset();
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}/commands` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { skills: { name: string }[] }).skills.map((s) => s.name)).toEqual(['a']);
    const calls = c.calls();
    await app.close();
    return calls;
  }

  it('commands: 8 rows cost what 80 do', async () => {
    // Compared per method, so a failure prints the call that grew with the registry.
    expect(await callsFor(8)).toEqual(await callsFor(80));
  });
});

// D-6434: the route reads the most recent FULL skill listing from a bounded tail of the transcript (at most four
// chunks of READ_FROM_MAX_BYTES, then the head), never the whole file. Fixtures are byte-exact so a chunk boundary
// lands where a case needs it: the filler lines are valid JSON of a chosen size.
describe('GET /api/sessions/:id/commands reads a bounded tail (D-6434)', () => {
  const CHUNK = READ_FROM_MAX_BYTES;
  const FILLER_HEAD = '{"type":"user","message":{"content":"';
  const FILLER_TAIL = '"}}\n';
  const OVERHEAD = FILLER_HEAD.length + FILLER_TAIL.length;

  /** One listing line. `isInitial` absent when undefined. */
  const listing = (content: string, isInitial?: boolean): string =>
    JSON.stringify({ attachment: { type: 'skill_listing', ...(isInitial === undefined ? {} : { isInitial }), content } }) + '\n';
  const full = (content: string): string => listing(content, true);
  const delta = (content: string): string => listing(content, false);

  /** Valid JSONL filler of exactly `total` bytes, in lines of about 4 KB. `multibyte`: pad with 2-byte characters,
   *  after one ASCII byte, so a line of even size puts every character's lead byte at an even offset. */
  function filler(total: number, multibyte = false): string {
    if (total === 0) return '';
    expect(total).toBeGreaterThanOrEqual(OVERHEAD);
    const k = Math.max(1, Math.ceil(total / 4000));
    let base = Math.floor(total / k);
    if (multibyte) base -= base % 2;
    const sizes = Array.from({ length: k }, (_, i) => (i === k - 1 ? total - base * (k - 1) : base));
    return sizes.map((n) => {
      const pad = n - OVERHEAD;
      return FILLER_HEAD + (multibyte ? 'x' + 'é'.repeat((pad - 1) / 2) : 'x'.repeat(pad)) + FILLER_TAIL;
    }).join('');
  }
  const bytes = (...parts: string[]): Buffer => Buffer.from(parts.join(''), 'utf8');

  interface Rig { skills: { name: string; desc: string }[]; transcriptCalls: Array<{ method: string; offset?: number; max?: number }> }
  /** The route over a fixture HOME whose transcript is `file`; every FleetIO call on the transcript is recorded and
   *  a range read at an offset in `failAt` answers `unreadable`. */
  async function rig(file: Buffer, failAt: ReadonlySet<number> = new Set()): Promise<Rig> {
    const home = mkTmp('ccrc-cmd-tail-');
    const id = 'project-a-ws-a';
    const uuid = '9'.repeat(36);
    const workdir = '/data/projects/project-a';
    seedRow(home, id, { wrapper: 'claude', uuid, workdir });
    const tdir = path.join(home, '.claude', 'projects', workdir.replace(/[/._]/g, '-'));
    mkdirSync(tdir, { recursive: true });
    const transcript = path.join(tdir, `${uuid}.jsonl`);
    writeFileSync(transcript, file);
    const transcriptCalls: Rig['transcriptCalls'] = [];
    const base = countingIO().io;
    const io = new Proxy(base, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver) as unknown;
        if (typeof v !== 'function' || typeof prop !== 'string') return v;
        return (...args: unknown[]) => {
          if (args[0] === transcript) {
            transcriptCalls.push({ method: prop, offset: args[1] as number | undefined, max: args[2] as number | undefined });
            if (prop === 'readFileFromBytesMeasured' && failAt.has(args[1] as number)) {
              return Promise.resolve({ ok: false, reason: 'unreadable' });
            }
          }
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const app = await buildServer({ ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), io });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}/commands` });
    expect(res.statusCode).toBe(200);
    const skills = (res.json() as { skills: Rig['skills'] }).skills;
    await app.close();
    return { skills, transcriptCalls };
  }
  const names = (r: Rig): string[] => r.skills.map((s) => s.name);

  it('commands: a transcript over 1 MiB costs at most six bounded reads', async () => {
    // The only full listing is on the first line: the four chunks find none, so the head read happens too.
    const file = bytes(full('- a: from the head'), filler(CHUNK * 6 - 100));
    expect(file.length).toBeGreaterThan(1024 * 1024);
    const r = await rig(file);
    expect(names(r)).toEqual(['a']);
    // The resolver's own continuation check (an 8 KiB tail window, a stat before it) is on the same path; what the
    // route adds is one stat, four chunks and the head. Nothing reads the file whole.
    const methods = (m: string): Rig['transcriptCalls'] => r.transcriptCalls.filter((c) => c.method === m);
    // An allow-list: every IO call on the transcript is a stat or a range read, so a whole-file read is a red here.
    const allowed = new Set(['stat', 'statMeasured', 'readFileFromMeasured', 'readFileFromBytesMeasured']);
    expect(r.transcriptCalls.filter((c) => !allowed.has(c.method)).map((c) => c.method)).toEqual([]);
    expect(methods('readFileFromMeasured').every((c) => c.offset! >= file.length - 8192)).toBe(true);
    const ranges = methods('readFileFromBytesMeasured');
    expect(ranges).toHaveLength(5);
    expect(ranges.every((c) => c.max! <= CHUNK)).toBe(true);
    expect(methods('statMeasured').length).toBeLessThanOrEqual(2);
  });

  it('a full listing then a delta answers both, full first', async () => {
    const file = bytes(
      full('- a: first\n- b: second'), filler(5000),
      delta('- c: third\n- b: second, renamed'), filler(3000),
    );
    const r = await rig(file);
    expect(r.skills).toEqual([
      { name: 'a', desc: 'first', kind: 'skill' },
      { name: 'b', desc: 'second, renamed', kind: 'skill' },
      { name: 'c', desc: 'third', kind: 'skill' },
    ]);
  });

  it('a delta before the latest full listing is ignored', async () => {
    const file = bytes(delta('- z: old delta'), filler(3000), full('- a: first\n- b: second'), filler(3000));
    expect(names(await rig(file))).toEqual(['a', 'b']);
  });

  it('a full listing across a chunk boundary is found whole', async () => {
    const L = full('- a: first\n- b: ' + 'the second skill, long enough to straddle a boundary '.repeat(4));
    const P = 300_000;
    const cutIn = Math.floor(Buffer.byteLength(L) / 2);
    const tail = CHUNK - (Buffer.byteLength(L) - cutIn);
    const file = bytes(filler(P), L, filler(tail));
    const boundary = file.length - CHUNK;
    expect(boundary).toBeGreaterThan(P);
    expect(boundary).toBeLessThan(P + Buffer.byteLength(L) - 1); // the boundary is inside the listing line
    expect(names(await rig(file))).toEqual(['a', 'b']);
  });

  it('a multibyte character split by a chunk boundary still parses', async () => {
    const P = 400_000; // even, and every filler line is of even size, so each starts at an even offset
    let L = '';
    let idx = -1;
    let desc = '';
    for (let pad = 0; pad < 4; pad++) {
      desc = `${'q'.repeat(pad)}price in €uros, ${'ünïcödé '.repeat(8)}end`;
      L = full(`- a: ${desc}`);
      idx = Buffer.from(L, 'utf8').indexOf(Buffer.from('€'));
      if (idx % 2 === 0) break; // the euro sign's second byte is then at an odd offset
    }
    expect(idx % 2).toBe(0);
    const tail = CHUNK - (Buffer.byteLength(L) - (idx + 1));
    const file = bytes(filler(P, true), L, filler(tail));
    const newer = file.length - CHUNK; // the first chunk starts here
    const older = file.length - 2 * CHUNK;
    // Self-check: the euro sign (E2 82 AC) is split by the newer boundary, and the older boundary splits a character
    // of the filler: the byte at each is a UTF-8 continuation byte.
    expect(file[newer - 1]).toBe(0xe2);
    expect(file[newer]! & 0xc0).toBe(0x80);
    expect(file[older]! & 0xc0).toBe(0x80);
    const r = await rig(file);
    expect(r.skills).toHaveLength(1);
    expect(r.skills[0]!.desc).toBe(desc);
  });

  it('no full listing in four chunks: the head\'s first answers', async () => {
    // Head: two full listings and a delta; a DIFFERENT full listing sits in the fifth chunk back; the window is filler.
    const S = CHUNK * 6;
    const head = bytes(full('- h1: first head'), full('- h2: second head'), delta('- hd: head delta'));
    const fifthChunkAt = Math.floor(S / 4) - head.length; // x lands inside [S - 5 chunks, S - 4 chunks)
    const x = Buffer.from(full('- x: from the fifth chunk'));
    const file = bytes(head.toString(), filler(fifthChunkAt), x.toString());
    const rest = S - file.length;
    const all = Buffer.concat([file, Buffer.from(filler(rest))]);
    expect(all.length).toBe(S);
    const xAt = all.indexOf(x);
    expect(xAt).toBeGreaterThanOrEqual(S - 5 * CHUNK);
    expect(xAt + x.length).toBeLessThanOrEqual(S - 4 * CHUNK);
    expect(names(await rig(all))).toEqual(['h2', 'hd']);
  });

  it('a bare name in a delta keeps the description it had', async () => {
    const file = bytes(full('- a: described\n- b: kept'), filler(3000), delta('- a\n- c: new'), filler(3000));
    expect((await rig(file)).skills).toEqual([
      { name: 'a', desc: 'described', kind: 'skill' },
      { name: 'b', desc: 'kept', kind: 'skill' },
      { name: 'c', desc: 'new', kind: 'skill' },
    ]);
  });

  it('a line that will not decode is skipped', async () => {
    // A newer full listing whose description carries a lone 0xFF byte (not UTF-8): the older valid one answers.
    const bad = Buffer.concat([
      Buffer.from('{"attachment":{"type":"skill_listing","isInitial":true,"content":"- z: bad '),
      Buffer.from([0xff]),
      Buffer.from(' byte"}}\n'),
    ]);
    const file = Buffer.concat([bytes(full('- a: valid'), filler(3000)), bad, bytes(filler(3000))]);
    expect(names(await rig(file))).toEqual(['a']);
  });

  it('no full listing in four chunks: the head\'s listing, then the window\'s deltas', async () => {
    // Head: full H (a, b). The window (the last four chunks) holds no full listing but two deltas, D1 (c) then D2
    // (b, renewed); a DIFFERENT full listing X sits in the fifth chunk back. Expect the head's answer, then D1, D2.
    const S = CHUNK * 6;
    const head = bytes(full('- a: from the head\n- b: old description'));
    const x = bytes(full('- x: from the fifth chunk'));
    const d1 = bytes(delta('- c: added in the window'));
    const d2 = bytes(delta('- b: new description'));
    const toX = Math.floor(S / 4) - head.length; // x lands inside [S - 5 chunks, S - 4 chunks)
    const toD1 = Math.floor(S / 2) - (head.length + toX + x.length);
    const toD2 = 5000;
    const toEnd = S - (head.length + toX + x.length + toD1 + d1.length + toD2 + d2.length);
    const all = Buffer.concat([head, bytes(filler(toX)), x, bytes(filler(toD1)), d1, bytes(filler(toD2)), d2, bytes(filler(toEnd))]);
    expect(all.length).toBe(S);
    expect(all.indexOf(x)).toBeLessThanOrEqual(S - 4 * CHUNK - x.length);
    expect(all.indexOf(d1)).toBeGreaterThanOrEqual(S - 4 * CHUNK);
    expect((await rig(all)).skills).toEqual([
      { name: 'a', desc: 'from the head', kind: 'skill' },
      { name: 'b', desc: 'new description', kind: 'skill' },
      { name: 'c', desc: 'added in the window', kind: 'skill' },
    ]);
  });

  it('no full listing anywhere: the window\'s deltas alone never answer', async () => {
    // Over four chunks, so the walk ends above offset 0 and the head fallback runs; the head is filler and no full
    // listing exists anywhere, only two deltas inside the window.
    const S = CHUNK * 6;
    const d1 = bytes(delta('- c: added in the window'));
    const d2 = bytes(delta('- b: also in the window'));
    const toD1 = Math.floor(S / 2);
    const toD2 = 5000;
    const toEnd = S - (toD1 + d1.length + toD2 + d2.length);
    const all = Buffer.concat([bytes(filler(toD1)), d1, bytes(filler(toD2)), d2, bytes(filler(toEnd))]);
    expect(all.length).toBe(S);
    expect(all.indexOf(d1)).toBeGreaterThanOrEqual(S - 4 * CHUNK);
    expect((await rig(all)).skills).toEqual([]);
  });

  it('deltas and no full listing: built-ins only', async () => {
    const file = bytes(delta('- a: one'), filler(4000), delta('- b: two'), filler(4000));
    expect((await rig(file)).skills).toEqual([]);
  });

  it('a failed chunk read: built-ins only', async () => {
    // 700 KB: three chunks. The only full listing is in the oldest; the middle chunk's read does not answer.
    const file = bytes(filler(50_000), full('- a: only here'), filler(700_000 - 50_000 - Buffer.byteLength(full('- a: only here'))));
    expect(file.length).toBe(700_000);
    const middleOffset = file.length - 2 * CHUNK;
    const ok = await rig(file);
    expect(names(ok)).toEqual(['a']); // control: unfailed, the listing is found
    const r = await rig(file, new Set([middleOffset]));
    expect(r.skills).toEqual([]);
    expect(r.transcriptCalls.some((c) => c.offset === middleOffset)).toBe(true);
  });

  it('a full listing on the file\'s first line is found', async () => {
    const L = full('- a: on line one');
    const file = bytes(L, filler(Math.floor(2.5 * CHUNK) - Buffer.byteLength(L)));
    expect(file.length).toBe(Math.floor(2.5 * CHUNK));
    expect(names(await rig(file))).toEqual(['a']);
  });
});
