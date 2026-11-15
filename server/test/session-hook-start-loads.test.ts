// server/test/session-hook-start-loads.test.ts
//
// Overlord W1 sandbox, Task 4 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md`; spec §3.6 H4): the hook's
// loads report. A `startup` or `resume` SessionStart of a session ccd launched under a surface (`CCRC_LAUNCH_PROFILE`)
// writes `$REG/<id>.loadpending`; each later main-thread `Stop` reads the transcript through `start_loads`
// (ccd/lib/transcript.jq) until the window holds the start's first request and the tool-bearing prompt snapshot after it,
// computes the body ONCE, spools it, and sends it through `ccrc-api sessions loads`. Rulings of 2026-11-15 folded in: the
// `tools` kind from the prompt snapshot (slug tools-read-from-the-prompt-snapshot) and the resume's bounded carry from its
// own reported start (slug resume-carries-its-own-start). The transcripts are Task 1's redacted fixtures
// (`fixtures/start-loads/`), their `/rig` paths moved into this suite's fixture HOME.
//
// Runs ccd/session-hook.sh for real inside a fixture HOME with a fake `ccrc-api` (the start-report suite's harness, copied:
// a test file cannot import another); no live box, no live server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const FIX = path.resolve(__dirname, 'fixtures/start-loads');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const SID = '00000000-0000-4000-8000-000000000001';
const ID = 'lane-a-project-a';
const DIGEST = 'd'.repeat(64);
const BUILD = '2.1.325';

let home: string;
const reg = (): string => path.join(home, '.cc-sessions');
const pend = (): string => path.join(reg(), `${ID}.loadpending`);
const tpath = (): string => path.join(home, 'cfg', 'projects', '-work', `${SID}.jsonl`);
beforeEach(() => {
  home = mkTmp('ccrc-hook-loads-');
  for (const d of [reg(), path.join(home, 'bin'), path.join(home, '.local', 'bin'), path.join(home, 'work'), path.dirname(tpath()),
    path.join(home, 'rig', 'repo', '.claude', 'rules')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(reg(), `${ID}.generation`), GENERATION);
  fs.writeFileSync(path.join(reg(), `${ID}.workdir`), path.join(home, 'rig', 'repo'));
  fs.writeFileSync(path.join(home, 'bin', 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
  // The rig's instruction files, at the fixture's paths moved under this HOME.
  fs.writeFileSync(path.join(home, 'rig', 'CLAUDE.md'), 'parent\n');
  fs.writeFileSync(path.join(home, 'rig', 'repo', 'CLAUDE.md'), 'constitution\n');
  fs.writeFileSync(path.join(home, 'rig', 'repo', '.claude', 'rules', 'w0-rule.md'), 'rule\n');
  // The fake client: `sessions start` answers 202; `sessions loads` records its argv and body and answers `loads.code`.
  fs.writeFileSync(path.join(home, '.local', 'bin', 'ccrc-api'), [
    '#!/bin/sh',
    'if [ "$1 $2" = "runs list" ]; then echo \'{"runs":[]}\'; echo "http 200" >&2; exit 0; fi',
    'if [ "$1 $2" = "sessions start" ]; then cat >/dev/null; echo \'{"ok":true}\'; echo "http 202" >&2; exit 0; fi',
    '[ "$1 $2" = "sessions loads" ] || exit 9',
    `printf '%s\\n' "$*" >> "${home}/api.argv"`,
    `cat >> "${home}/api.bodies"`,
    `set -- $(cat "${home}/loads.code" 2>/dev/null || echo 202)`,
    'if [ "$1" = 202 ]; then echo \'{"ok":true,"startId":1,"fresh":true}\'; else echo "{\\"ok\\":false,\\"error\\":\\"$2\\"}"; fi',
    'echo "http $1" >&2; exit 0',
  ].join('\n') + '\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const answer = (code: string): void => { fs.writeFileSync(path.join(home, 'loads.code'), code); };
const sent = (): string[] => {
  const f = path.join(home, 'api.bodies');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.length > 0) : [];
};
const body = (i = 0): Record<string, any> => JSON.parse(sent()[i]!) as Record<string, any>;
const pendLines = (): string[] | null => (fs.existsSync(pend()) ? fs.readFileSync(pend(), 'utf8').split('\n').filter((l) => l.length > 0) : null);
/** A fixture's lines with its `/rig` paths moved under this HOME. */
const fixLines = (name: string): string[] =>
  fs.readFileSync(path.join(FIX, name), 'utf8').split('\n').filter((l) => l.length > 0).map((l) => l.split('/rig/').join(`${home}/rig/`));
const writeT = (lines: readonly string[]): void => { fs.writeFileSync(tpath(), lines.length ? `${lines.join('\n')}\n` : ''); };
/** The index of the first line of `lines` matching `pred` (a parsed row). */
const at = (lines: readonly string[], pred: (r: Record<string, any>) => boolean, from = 0): number =>
  lines.findIndex((l, i) => i >= from && pred(JSON.parse(l) as Record<string, any>));
const isMarker = (r: Record<string, any>): boolean => r.type === 'api-request' && r.querySource === 'repl_main_thread';
const isToolSnap = (r: Record<string, any>): boolean => r.type === 'attachment' && r.attachment?.type === 'prompt_snapshot' && Array.isArray(r.attachment.tools);

const ENV = { CCRC_LAUNCH_PROFILE: `overlord:${DIGEST}`, CCRC_LAUNCH_RC: 'off', CLAUDE_CODE_EXECPATH: `/x/versions/${BUILD}` };
const base = (): object => ({ session_id: SID, transcript_path: tpath(), cwd: path.join(home, 'rig', 'repo') });
const start = (source: string): object => ({ ...base(), hook_event_name: 'SessionStart', source, model: 'claude-model-a' });
const stop = (): object => ({ ...base(), hook_event_name: 'Stop', stop_hook_active: false, permission_mode: 'bypassPermissions' });
const hook = (p: object, env: Record<string, string> = ENV): number | null => spawnSync('bash', [HOOK], {
  input: JSON.stringify(p), encoding: 'utf8',
  env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`, TMUX_PANE: '%1',
    CLAUDE_CODE_SESSION_ID: SID, CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION, ...env },
}).status;
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

/** A startup run of the fixture: SessionStart on an absent transcript, then the whole startup transcript, then one Stop. */
const startup = (env: Record<string, string> = ENV): void => {
  writeT([]); fs.rmSync(tpath());
  hook(start('startup'), env);
  writeT(fixLines(`transcript-${BUILD}-startup.jsonl`));
  hook(stop(), env);
};

describe('the pending report (Task 4)', () => {
  it('a startup SessionStart under a surface writes loadpending: no tries, a reportId, the window offset, the source, the path', () => {
    writeT(['{"type":"x"}']);
    hook(start('startup'));
    const [t, rid, off, src, tp] = pendLines()![0]!.split('\t');
    expect([t, off, src, tp]).toStrictEqual(['0', String(fs.statSync(tpath()).size), 'startup', tpath()]);
    expect(rid).toMatch(/^\d+-\d+-\d+$/);
  });
  it('nothing at all for a session without the variable, and nothing for a clear or compact start', () => {
    hook(start('startup'), {});
    expect(fs.existsSync(pend())).toBe(false);
    for (const s of ['clear', 'compact']) { hook(start(s)); expect(fs.existsSync(pend()), s).toBe(false); }
    writeT(fixLines(`transcript-${BUILD}-startup.jsonl`));
    hook(stop(), {});
    expect(sent()).toStrictEqual([]);
  });
});

describe('the body (Task 4, M4 fixtures)', () => {
  for (const build of ['2.1.325', '2.1.323']) {
    it(`a startup on ${build}: every kind measured, sent once, the file removed and the start remembered`, () => {
      const env = { ...ENV, CLAUDE_CODE_EXECPATH: `/x/versions/${build}` };
      writeT([]); fs.rmSync(tpath());
      hook(start('startup'), env);
      writeT(fixLines(`transcript-${build}-startup.jsonl`));
      hook(stop(), env);
      expect(sent()).toHaveLength(1);
      const b = body();
      expect(b).toMatchObject({ fromId: ID, fromUuid: SID, profileRole: 'overlord', profileDigest: DIGEST, launchRc: 'off',
        claudeVersion: build, permissionMode: 'bypassPermissions', cwdInWorkspace: true });
      expect(b.loaded.instructions).toStrictEqual([
        { type: 'Project', name: 'CLAUDE.md', inWorkspace: false, sha256: sha('parent\n') },
        { type: 'Project', name: 'CLAUDE.md', inWorkspace: true, sha256: sha('constitution\n') },
        { type: 'Project', name: 'w0-rule.md', inWorkspace: true, sha256: sha('rule\n') },
      ]);
      expect(b.loaded.hooks).toStrictEqual([sha('bash "$HOME/.cc-sessions/session-hook.sh"'), sha("sh -c 'echo w0-sandbox-failing-hook >&2; exit 1'")].sort());
      expect(b.loaded.skills).toContain('ccrc-overlord');
      expect(b.loaded.agents).toStrictEqual(['Explore', 'Plan', 'general-purpose', 'overlord-reader']);
      expect(b.loaded.tools).toStrictEqual(['Agent', 'Skill', 'mcp__door__act', 'mcp__door__card', 'mcp__door__read']);
      expect(b.loaded.toolServers).toStrictEqual(['door']);
      expect(b).not.toHaveProperty('carriedFrom');
      expect(JSON.stringify(b)).not.toContain('session-hook.sh');
      expect(fs.existsSync(pend())).toBe(false);
      expect(fs.readFileSync(path.join(reg(), `${ID}.loadlast`), 'utf8').split('\t').slice(1, 4)).toStrictEqual([DIGEST, build, '0']);
    });
  }
  it('a window with no first-request marker sends nothing, keeps the file and counts a try; the fifth drops it', () => {
    writeT([]); fs.rmSync(tpath());
    hook(start('startup'));
    const lines = fixLines(`transcript-${BUILD}-startup.jsonl`);
    writeT(lines.slice(0, at(lines, isMarker)));
    for (let i = 1; i <= 4; i++) { hook(stop()); expect(pendLines()![0]!.split('\t')[0], `try ${i}`).toBe(String(i)); }
    hook(stop());
    expect(sent()).toStrictEqual([]);
    expect(fs.existsSync(pend())).toBe(false);
  });
  it('the marker without the tool-bearing snapshot waits; the last try sends tools and tool servers unmeasured, never empty', () => {
    writeT([]); fs.rmSync(tpath());
    hook(start('startup'));
    const lines = fixLines(`transcript-${BUILD}-startup.jsonl`);
    writeT(lines.slice(0, at(lines, isToolSnap)));
    for (let i = 1; i <= 4; i++) hook(stop());
    expect(sent()).toStrictEqual([]);
    hook(stop());
    expect(sent()).toHaveLength(1);
    expect(body().loaded).toMatchObject({ tools: 'unmeasured', toolServers: 'unmeasured' });
    expect(body().loaded.instructions).not.toBe('unmeasured');
  });
  it('a send whose 202 is lost is resent as the same bytes; a later Stop with a longer transcript resends the spooled body unchanged', () => {
    answer('500 internal');
    startup();
    expect(pendLines()).toHaveLength(2);
    fs.appendFileSync(tpath(), `${JSON.stringify({ type: 'user', message: { content: 'later' } })}\n`);
    answer('202');
    hook(stop());
    expect(sent()).toHaveLength(2);
    expect(sent()[1]).toBe(sent()[0]);
    expect(fs.existsSync(pend())).toBe(false);
  });
  it('a 404 (an older server or unknown-start) and a 401 keep it and count a try; any other 4xx drops it', () => {
    for (const code of ['404 unknown-start', '401 unauthenticated']) {
      answer(code); startup();
      expect(pendLines()![0]!.split('\t')[0], code).toBe('1');
      fs.rmSync(pend()); fs.rmSync(path.join(home, 'api.bodies'));
    }
    answer('400 bad-request'); startup();
    expect(fs.existsSync(pend())).toBe(false);
  });
  it('an older start\'s instructions before the offset are not read for a window kind', () => {
    const lines = fixLines(`transcript-${BUILD}-startup.jsonl`);
    writeT(lines);
    hook(start('startup'));                      // the offset is the whole startup transcript
    const marker = lines[at(lines, isMarker)]!;
    const snap = lines[at(lines, isToolSnap)]!;
    fs.appendFileSync(tpath(), `${marker}\n${snap}\n`);
    hook(stop());
    expect(body().loaded.instructions).toBe('unmeasured');
    expect(body().loaded.hooks).toBe('unmeasured');
  });
  it('an attachment of a shape this build does not know reads that kind unmeasured', () => {
    writeT([]); fs.rmSync(tpath());
    hook(start('startup'));
    writeT(fixLines(`transcript-${BUILD}-startup.jsonl`).map((l) => {
      const r = JSON.parse(l) as Record<string, any>;
      if (r.type === 'attachment' && r.attachment?.type === 'instructions') r.attachment.files = 'not a list';
      if (r.type === 'attachment' && r.attachment?.type === 'agent_listing_delta') r.attachment.addedTypes = { x: 1 };
      return JSON.stringify(r);
    }));
    hook(stop());
    expect(body().loaded).toMatchObject({ instructions: 'unmeasured', agents: 'unmeasured' });
    expect(body().loaded.skills).not.toBe('unmeasured');
  });
  it('a transcript over the 16 MiB bound sends nothing and keeps the file', () => {
    writeT([]); fs.rmSync(tpath());
    hook(start('startup'));
    writeT(fixLines(`transcript-${BUILD}-startup.jsonl`));
    fs.appendFileSync(tpath(), `${JSON.stringify({ type: 'pad', p: 'p'.repeat(16 * 1024 * 1024) })}\n`);
    hook(stop());
    expect(sent()).toStrictEqual([]);
    expect(pendLines()![0]!.split('\t')[0]).toBe('1');
  });
});

describe('the resume carries its own start, under equality (ruled 2026-11-15, slug resume-carries-its-own-start)', () => {
  /** A startup reported (202), then a resume of the same transcript: the resume fixture's resume region appended. */
  const resume = (env: Record<string, string>): void => {
    startup();
    const r = fixLines(`transcript-${BUILD}-resume.jsonl`);
    const from = at(r, (x) => isMarker(x) && x.timestamp > '2026-11-15T05:17');   // the resume's request
    hook(start('resume'), env);
    fs.appendFileSync(tpath(), `${r.slice(from - 2).join('\n')}\n`);
    for (let i = 0; i < 5 && fs.existsSync(pend()); i++) hook(stop(), env);
  };
  it('equal digest and build: instructions and hooks carried, named carriedFrom; tools unmeasured (a resume writes no snapshot)', () => {
    resume(ENV);
    const first = body(0);
    const b = body(1);
    expect(b.carriedFrom).toBe(first.reportId);
    expect(b.loaded.instructions).toStrictEqual(first.loaded.instructions);
    expect(b.loaded.hooks).toStrictEqual(first.loaded.hooks);
    expect(b.loaded.tools).toBe('unmeasured');
  });
  it('a digest that differs: unmeasured, nothing carried', () => {
    resume({ ...ENV, CCRC_LAUNCH_PROFILE: `overlord:${'e'.repeat(64)}` });
    expect(body(1).loaded).toMatchObject({ instructions: 'unmeasured', hooks: 'unmeasured' });
    expect(body(1)).not.toHaveProperty('carriedFrom');
  });
  it('a build that differs: unmeasured, nothing carried', () => {
    resume({ ...ENV, CLAUDE_CODE_EXECPATH: '/x/versions/2.1.323' });
    expect(body(1).loaded).toMatchObject({ instructions: 'unmeasured', hooks: 'unmeasured' });
    expect(body(1)).not.toHaveProperty('carriedFrom');
  });
  it('no prior reported start: unmeasured, nothing carried', () => {
    startup();
    fs.rmSync(path.join(reg(), `${ID}.loadlast`));
    const r = fixLines(`transcript-${BUILD}-resume.jsonl`);
    const from = at(r, (x) => isMarker(x) && x.timestamp > '2026-11-15T05:17');
    hook(start('resume'));
    fs.appendFileSync(tpath(), `${r.slice(from - 2).join('\n')}\n`);
    for (let i = 0; i < 5 && fs.existsSync(pend()); i++) hook(stop());
    expect(body(1).loaded).toMatchObject({ instructions: 'unmeasured', hooks: 'unmeasured' });
    expect(body(1)).not.toHaveProperty('carriedFrom');
  });
});
