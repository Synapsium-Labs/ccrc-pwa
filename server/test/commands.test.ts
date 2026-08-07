import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { ccdRunner } from '../src/lifecycle.js';
import { parseSkillListing, BUILTINS } from '../src/commands.js';
import { KeyedQueue } from '../src/inject/queue.js';
import { mkTmp } from './tmpHelpers.js';

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
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const id = 'claude2-rp-llm';
    const workdir = '/data/projects/rp-llm';
    const uuid = '9'.repeat(36);
    for (const [k, v] of Object.entries({ wrapper: 'claude2', project: 'rp-llm', workdir, uuid, started: '1' })) {
      writeFileSync(path.join(reg, `${id}.${k}`), v);
    }
    const munged = workdir.replace(/[/._]/g, '-');
    const tdir = path.join(home, '.claude-personal', 'projects', munged);
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

  it('unknown session id returns 404', async () => {
    const home = mkTmp('ccrc-cmd-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const run: Runner = async () => ({ code: 0, stdout: '', stderr: '' });
    const cfg = loadConfig({ CCRC_HOME: home });
    const app = await buildServer({ cfg, runCcd: ccdRunner(run, cfg), tmux: new Tmux(run), io: localIO, queue: new KeyedQueue() });
    const res = await app.inject({ method: 'GET', url: '/api/sessions/nope/commands' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
