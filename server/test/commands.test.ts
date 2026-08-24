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
import { seedRoster } from './helpers.js';

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
    const id = 'claude-a-rp-llm';
    const workdir = '/data/projects/rp-llm';
    const uuid = '9'.repeat(36);
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'rp-llm', workdir, uuid, started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    const munged = workdir.replace(/[/._]/g, '-');
    const tdir = path.join(home, '.claude-a', 'projects', munged);
    mkdirSync(tdir, { recursive: true });
    const skillListing = { attachment: { type: 'skill_listing', content: '- superpowers:writing-plans: Use when you have a spec.\n- graphify: Turn input into a graph.' } };
    writeFileSync(path.join(tdir, `${uuid}.jsonl`), JSON.stringify(skillListing) + '\n');

    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 1, stdout: '', stderr: '' }; // dead → uses registry workdir
      return { code: 0, stdout: '', stderr: '' };
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
    const id = 'claude-a-rp-llm';
    const workdir = '/data/projects/rp-llm';
    const uuid = '8'.repeat(36);
    for (const [k, v] of Object.entries({ wrapper: 'claude-a', project: 'rp-llm', workdir, uuid, started: '1' })) {
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
      if (args[0] === 'has-session') return { code: 1, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
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
    const id = 'claude-a-rp-llm-pin';
    const registryWorkdir = '/data/projects/rp-llm';
    const liveCwd = '/data/projects/rp-llm-worktree'; // moved — e.g. into a worktree
    const uuid = '7'.repeat(36);
    const pid = 5551;
    for (const [k, v] of Object.entries(
      { wrapper: 'claude-a', project: 'rp-llm', workdir: registryWorkdir, uuid, started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    const cfgDir = path.join(home, '.claude-a');
    mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
    writeFileSync(path.join(cfgDir, 'sessions', `${pid}.json`), JSON.stringify({
      pid, sessionId: uuid, cwd: liveCwd, name: 'rp-llm', status: 'idle', statusUpdatedAt: 1, version: '2.1.210',
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
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };  // LIVE
      if (args[0] === 'list-panes') return { code: 0, stdout: `${pid}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'GET', url: `/api/sessions/${id}/commands` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { skills: { name: string }[] };
    expect(body.skills.map((s) => s.name)).toEqual(['graphify']);  // exact rung, not the newer decoy
    await app.close();
  });

  it('unknown session id returns 404', async () => {
    const home = mkTmp('ccrc-cmd-');
    seedRoster(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nope/commands' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
