// The Overlord's W0 spike (plan docs/superpowers/plans/2026-11-10-overlord/w0-spike.md, Tasks 2 and 3): the capture
// rig learns a launch profile, and gains four dependency-free stubs. Hermetic: no row starts Claude Code, names the
// real HOME, or touches any tmux server; the run-time verbs are run from rig.sh's own text with tmux stubbed. The
// helpers are this file's own, in the shape of delegation-rig.test.ts's (whose helpers are not exported).
import { describe, it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';

const RIG = path.resolve(__dirname, 'delegation-rig');
const LINUX = process.platform === 'linux';
const RIGSH = path.join(RIG, 'rig.sh');

const rigsh = (args: string[], env: NodeJS.ProcessEnv = {}): { status: number | null; stdout: string; stderr: string } => {
  const r = spawnSyncGroup('bash', [RIGSH, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
/** A scenario file at <tmp>/<dir>/<name>.json: `{ steps, entries: [], ...top }`, so `top.steps` replaces `steps`. */
function scen(dir: string, name: string, steps: object[], top: object = {}): string {
  const d = path.join(mkTmp('ccrc-dlg-w0-'), dir);
  fs.mkdirSync(d, { recursive: true });
  const f = path.join(d, `${name}.json`);
  fs.writeFileSync(f, JSON.stringify({ steps, entries: [], ...top }));
  return f;
}
/** A single-quoted space-separated list defined once in rig.sh, read from its source and never restated here. */
function rigList(name: string): string[] {
  const m = new RegExp(`^${name}='([^']*)'$`, 'm').exec(fs.readFileSync(RIGSH, 'utf8'));
  return m ? (m[1] as string).split(/\s+/).filter(Boolean) : [];
}
function firstEnvName(): string {
  const n = rigList('RIG_LAUNCH_ENV')[0];
  if (n === undefined) throw new Error('rig.sh defines no RIG_LAUNCH_ENV list');
  return n;
}
/** The text of rig.sh's own top-level definitions named here (a function, through its closing `}` line, or a `NAME=`
 *  line), so a row runs them without the case dispatch at its foot. */
function rigText(...names: string[]): string {
  const lines = fs.readFileSync(RIGSH, 'utf8').split('\n');
  return names.map((n) => {
    const i = lines.findIndex((l) => l.startsWith(`${n}() {`) || l.startsWith(`${n}=`));
    if (i < 0) throw new Error(`rig.sh defines no ${n}`);
    const first = lines[i] as string;
    if (!first.startsWith(`${n}() {`) || first.trimEnd().endsWith('}')) return first;
    const j = lines.indexOf('}', i);
    if (j < i) throw new Error(`rig.sh's ${n} does not close`);
    return lines.slice(i, j + 1).join('\n');
  }).join('\n');
}
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
/** The bypass spellings a scenario of the delegation corpus may never carry (the corpus test reads them too). */
const BYPASS_RE = /skip-permissions|bypassPermissions/;
/** A fixture HOME holding one executable "installed" build, as delegation-rig.test.ts's versionsHome makes it. */
function versionsHome(version: string): string {
  const home = mkTmp('ccrc-dlg-home-');
  const dir = path.join(home, '.local/share/claude/versions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, version), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(dir, version), 0o755);
  return home;
}
let cfg = '';
/** print-launch's line for a scenarios-overlord scenario carrying `launch`; sets `cfg` to that run root's config dir. */
function launchLine(launch: object, top: object = {}): string {
  const f = scen('scenarios-overlord', 'pl', [{ waitReady: 60 }], { launch, ...top });
  const root = path.join(mkTmp('ccrc-dlg-pl-'), 'ccrc-dlg-rig.t');
  cfg = path.join(root, 'fixhome', 'cfg');
  const r = rigsh(['print-launch', '2.1.290', f, root], { HOME: versionsHome('2.1.290') });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

describe('rig.sh: a scenario may carry a launch profile (W0 Task 2)', () => {
  it('check-scenario accepts a launch block whose flags and env names are on the lists', () => {
    const f = scen('scenarios-overlord', 'ok', [{ waitReady: 60 }],
      { launch: { args: ['--setting-sources', 'project', '--strict-mcp-config', '--model=opus', '--disable-slash-commands'],
        env: { [firstEnvName()]: 'x' } }, capS: 600, requests: true, mainMarker: 'You are (an interactive agent|Claude Code)' });
    expect(rigsh(['check-scenario', f]).status).toBe(0);
  }, 60_000);

  it.each([
    ['a flag off the list', { launch: { args: ['--no-such-flag'] } }],
    ['a value with no flag before it', { launch: { args: ['project'] } }],
    ['a value after a flag that takes none (F4)', { launch: { args: ['--strict-mcp-config', 'update'] } }],
    ['a second value after a flag (F4)', { launch: { args: ['--model', 'opus', 'install'] } }],
    ['a value after a --flag=value spelling (F4)', { launch: { args: ['--model=opus', 'update'] } }],
    ['a value spelled onto a flag that takes none (F4)', { launch: { args: ['--strict-mcp-config=update'] } }],
    ['a flag that takes a value, last (F4)', { launch: { args: ['--model'] } }],
    ['a flag that takes a value, followed by a flag (F4)', { launch: { args: ['--model', '--strict-mcp-config'] } }],
    ['a mainMarker that is not a string (F2)', { mainMarker: 7 }],
    ['a mainMarker of two lines (F2)', { mainMarker: 'a\nb' }],
    ['a mainMarker that is no regular expression (M1)', { mainMarker: '(' }],
    ['a mainMarker whose quantifier is out of order (M1)', { mainMarker: 'a{2,1}' }],
    ['a reserved env name', { launch: { env: { HOME: '/x' } } }],
    ['an ANTHROPIC_ name', { launch: { env: { ANTHROPIC_BASE_URL: 'http://x' } } }],
    ['an env name off the list', { launch: { env: { NOT_ON_THE_LIST: 'x' } } }],
    ['an unknown launch key', { launch: { argv: [] } }],
    ['an absolute file path', { launch: { files: [{ in: 'repo', path: '/etc/x', text: '' }] } }],
    ['a .. segment', { launch: { files: [{ in: 'cfg', path: 'a/../../x', text: '' }] } }],
    ['a file target that is neither cfg nor repo', { launch: { files: [{ in: 'home', path: 'x', text: '' }] } }],
    ['a capS over 5400', { capS: 5401 }],
    ['a capS under 60', { capS: 59 }],
    ['a relaunch mode that is not fresh or fork', { steps: [{ relaunch: { mode: 'other' } }] }],
    ['a sessionsSnap name with a slash', { steps: [{ sessionsSnap: 'a/b' }] }],
  ])('check-scenario refuses %s, exit 2', (_w, top) => {
    expect(rigsh(['check-scenario', scen('scenarios-overlord', 'bad', [{ waitReady: 60 }], top)]).status).toBe(2);
  }, 60_000);

  it('check-scenario accepts the three relaunch forms and a sessionsSnap step', () => {
    const f = scen('scenarios-overlord', 'rl', [{ relaunch: true }, { relaunch: { mode: 'fresh' } }, { relaunch: { mode: 'fork' } },
      { sessionsSnap: 'before-compact' }]);
    expect(rigsh(['check-scenario', f]).status).toBe(0);
  }, 60_000);

  // check-scenario compiles the marker as the mock will, and the marker reaches node through the file, never as an argument
  // node could read as an option of its own: scenario text never runs code (review 1789 F1).
  it('a mainMarker spelled as node\'s --import runs nothing: the module that would write a file is never loaded (F1)', () => {
    const t = mkTmp('ccrc-dlg-mark-');
    const proof = path.join(t, 'proof.txt');
    const mod = path.join(t, 'ran.mjs');
    fs.writeFileSync(mod, `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(proof)}, 'ran');\n`);
    const marker = `--import=${pathToFileURL(mod).href}`;
    expect(marker.length, 'the premise: within the marker\'s 200 characters').toBeLessThanOrEqual(200);
    const r = rigsh(['check-scenario', scen('scenarios-overlord', 'imp', [{ waitReady: 60 }], { mainMarker: marker })]);
    expect(fs.existsSync(proof), 'the module ran').toBe(false);
    expect(r.status, 'a valid regular expression, accepted as one').toBe(0);
  }, 60_000);

  it.each([
    ['--title=(', 2],
    ['-x', 0],
  ])('a mainMarker %s, which starts with a dash, is compiled as the regular expression it is: exit %s (F1)', (marker, code) => {
    expect(rigsh(['check-scenario', scen('scenarios-overlord', 'dash', [{ waitReady: 60 }], { mainMarker: marker })]).status).toBe(code);
  }, 60_000);

  // D-8203's exception is the rig's own rule, not only the corpus test's (F3): a bypass anywhere in the scenario's text, in a
  // flag, a --settings value or a file the scenario writes, passes only for a file in the rig's own scenarios-overlord.
  const SETTINGS_BYPASS = '{"permissions":{"defaultMode":"bypassPermissions"}}';
  it.each([
    ['the flag', { launch: { args: ['--dangerously-skip-permissions'] } }],
    ['the permission mode', { launch: { args: ['--permission-mode', 'bypassPermissions'] } }],
    ['the permission mode in one argument', { launch: { args: ['--permission-mode=bypassPermissions'] } }],
    ['the settings mode', { launch: { settings: { permissions: { defaultMode: 'bypassPermissions' } } } }],
    ['an inline --settings value', { launch: { args: ['--settings', SETTINGS_BYPASS] } }],
    ['a settings file the scenario writes', { launch: { args: ['--settings', '@RIG_REPO@/.w0/p.json'],
      files: [{ in: 'repo', path: '.w0/p.json', text: SETTINGS_BYPASS }] } }],
    ['an overwrite of the fixture\'s settings', { launch: { files: [{ in: 'cfg', path: 'settings.json', text: SETTINGS_BYPASS }] } }],
  ])('a bypass by %s is refused outside the rig\'s own scenarios-overlord, whatever the directory is called (F3)', (_w, top) => {
    for (const dir of ['scenarios', 'scenarios-overlord', 'server/test/delegation-rig/scenarios-overlord'])
      expect(rigsh(['check-scenario', scen(dir, 'b', [{ waitReady: 60 }], top)]).status, dir).toBe(2);
  }, 60_000);

  it('a bypass spelled through a JSON escape is refused too: the check reads the parsed strings (F3)', () => {
    const f = scen('scenarios-overlord', 'esc', [{ waitReady: 60 }], { launch: { args: ['--permission-mode', 'BYPASS'] } });
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('BYPASS', 'bypass\\u0050ermissions'));
    expect(fs.readFileSync(f, 'utf8')).not.toMatch(BYPASS_RE);
    expect(rigsh(['check-scenario', f]).status).toBe(2);
  }, 60_000);

  // Claude Code parses a --settings value, an --agents value and a settings file as JSON itself, so a bypass escaped INSIDE
  // such a string survives one decoding of the scenario: the check decodes every string that is JSON again (review 1787 F1).
  const NESTED = '{"permissions":{"defaultMode":"bypass\\u0050ermissions"}}';
  it.each([
    ['an inline --settings value', { launch: { args: ['--settings', NESTED] } }],
    ['an overwrite of the fixture\'s settings', { launch: { files: [{ in: 'cfg', path: 'settings.json', text: NESTED }] } }],
    ['a --settings file the scenario writes', { launch: { args: ['--settings', '@RIG_REPO@/.w0/p.json'],
      files: [{ in: 'repo', path: '.w0/p.json', text: NESTED }] } }],
    ['an --agents permissionMode', { launch: { args: ['--agents',
      '{"r":{"description":"x","prompt":"x","permissionMode":"bypass\\u0050ermissions"}}'] } }],
  ])('a bypass escaped inside a JSON string, by %s, is refused outside the rig\'s own scenarios-overlord (F1)', (_w, top) => {
    const f = scen('scenarios', 'nested', [{ waitReady: 60 }], top);
    expect(fs.readFileSync(f, 'utf8'), 'the premise: one decoding does not show it').not.toMatch(BYPASS_RE);
    expect(rigsh(['check-scenario', f]).status).toBe(2);
  }, 60_000);

  it('a bypass spelled in a key, through a JSON escape, is refused: the check reads the keys too (M2)', () => {
    const f = scen('scenarios', 'key', [{ waitReady: 60 }], { launch: { settings: { permissions: { KEYX: true } } } });
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('KEYX', 'bypass\\u0050ermissions'));
    expect(fs.readFileSync(f, 'utf8').toLowerCase().replace(/\\/g, '')).not.toMatch(/bypasspermissions/);
    expect(rigsh(['check-scenario', f]).status).toBe(2);
  }, 60_000);

  // A shell script a scenario writes unescapes `\P` to `P` when it runs; the raw text, lower-cased with every backslash
  // removed, is read for both spellings too, outside the rig's own scenarios-overlord (review 1787 F1).
  it.each([
    ['--permission-mode bypass\\Permissions', 'the permission mode'],
    ['--dangerously-skip\\-permissions', 'the flag'],
  ])('a bypass that only a shell would unescape, %s (%s), is refused outside the rig\'s own scenarios-overlord (F1)', (spelled) => {
    const f = scen('scenarios', 'raw', [{ waitReady: 60 }],
      { launch: { files: [{ in: 'repo', path: '.w0/run.sh', text: `#!/bin/sh\nexec true ${spelled}\n`, exec: true }] } });
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).launch.files[0].text, 'the premise: the decoded text hides it').not.toMatch(
      /bypass[-_ ]?permissions|dangerously[-_ ]?skip[-_ ]?permissions/i);
    expect(rigsh(['check-scenario', f]).status).toBe(2);
  }, 60_000);

  /** The premise of a row below: what the scan read before review 1789 F2 hides the bypass. Every string and key once
   *  decoded, and the raw text lower-cased with every backslash removed, carry no spelling of it. */
  function hiddenFromTheOldScan(f: string): void {
    const raw = fs.readFileSync(f, 'utf8');
    const texts = (v: unknown): string[] => typeof v === 'string' ? [v]
      : v !== null && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...texts(x)]) : [];
    expect(texts(JSON.parse(raw)).filter((s) => /bypass[-_ ]?permissions|dangerously[-_ ]?skip[-_ ]?permissions/i.test(s)),
      'the premise: no decoded string shows it').toEqual([]);
    expect(raw.toLowerCase().replace(/\\/g, ''), 'the premise: the raw text without backslashes hides it')
      .not.toMatch(/bypasspermissions|dangerously-skip-permissions/);
  }
  // YAML (a subagent file's frontmatter) and a settings file that is not strict JSON keep escapes of their own, which no
  // JSON decoding undoes: the check decodes \xHH, \uHHHH and \UHHHHHHHH and joins a backslash-newline continuation, in every
  // string and in the raw text, before it looks (review 1789 F2).
  const frontmatter = (mode: string): string => `---\nname: r\ndescription: x\npermissionMode: ${mode}\n---\nx\n`;
  const YAML_FORMS: [string, string][] = [
    ['a \\x escape', '"bypass\\x50ermissions"'],
    ['a \\u escape', '"bypass\\u0050ermissions"'],
    ['a \\U escape', '"bypass\\U00000050ermissions"'],
    ['a line continuation', '"bypass\\\n    Permissions"'],
  ];
  it.each(YAML_FORMS.flatMap(([w, mode]) => [[w, '.claude/agents/r.md', 'repo', mode], [w, 'agents/r.md', 'cfg', mode]]))(
    'a subagent file\'s permissionMode spelled with %s, at %s, is refused outside the rig\'s own scenarios-overlord (F2)',
    (_w, p, where, mode) => {
      const text = frontmatter(mode as string);
      expect(parseYaml((text.split('---\n')[1]) as string).permissionMode, 'the premise: YAML reads the bypass').toBe('bypassPermissions');
      const f = scen('scenarios', 'yaml', [{ waitReady: 60 }], { launch: { files: [{ in: where, path: p, text }] } });
      hiddenFromTheOldScan(f);
      expect(rigsh(['check-scenario', f]).status).toBe(2);
    }, 60_000);

  it.each([
    ['a comment', '{\n  // the mode\n  "permissions": {"defaultMode": "bypass\\u0050ermissions"}\n}\n'],
    ['a trailing comma', '{"permissions": {"defaultMode": "bypass\\u0050ermissions",},}'],
    ['single quotes', '{\'permissions\': {\'defaultMode\': \'bypass\\u0050ermissions\'}}'],
    ['unquoted keys', '{permissions: {defaultMode: "bypass\\x50ermissions"}}'],
  ])('a settings file that is not strict JSON, with %s and the mode escaped, is refused outside the rig\'s own scenarios-overlord (F2)',
    (_w, text) => {
      expect(() => JSON.parse(text), 'the premise: no strict JSON reader decodes it').toThrow();
      const f = scen('scenarios', 'loose', [{ waitReady: 60 }], { launch: { files: [{ in: 'cfg', path: 'settings.json', text }] } });
      hiddenFromTheOldScan(f);
      expect(rigsh(['check-scenario', f]).status).toBe(2);
    }, 60_000);

  // A continuation's newline is a JSON `\n` escape until a JSON decoding makes it one, so a continuation two JSON levels
  // down is found only by a scan that decodes two levels: the row holds BYPASS_JSON_DEPTH at 2 or more (review 1789 M-a).
  it('a bypass two JSON levels deep is refused, so the scan decodes at least two levels (M-a)', () => {
    const inner = JSON.stringify({ permissions: { defaultMode: 'bypass\\\n  Permissions' } });
    const outer = JSON.stringify({ env: { W0_X: inner } });
    const f = scen('scenarios', 'deep', [{ waitReady: 60 }], { launch: { files: [{ in: 'cfg', path: 'settings.json', text: outer }] } });
    hiddenFromTheOldScan(f);
    expect(rigsh(['check-scenario', f]).status).toBe(2);
  }, 60_000);

  // The raw text is read as well as the parse: a duplicate key the parse drops (jq and the mock keep the last) still shows.
  it('a bypass under a key a later duplicate hides from the parse is refused outside the rig\'s own scenarios-overlord: the raw text is read', () => {
    const d = path.join(mkTmp('ccrc-dlg-w0-'), 'scenarios');
    fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, 'dup.json');
    fs.writeFileSync(f, '{"steps":[{"waitReady":60}],"entries":[],"launch":{"args":["--dangerously-skip-permissions"]},"launch":{"args":[]}}');
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).launch.args, 'the premise: the parse keeps the clean one').toEqual([]);
    expect(rigsh(['check-scenario', f]).status).toBe(2);
  }, 60_000);

  // The scan answers found, not found, or could not look; the last refuses, so an error never reads as a clean scenario.
  it('a scan that cannot run refuses the scenario: with BYPASS_JSON_DEPTH unreadable, an escaped bypass is still refused', () => {
    const d = mkTmp('ccrc-dlg-w0-scan-');
    const src = fs.readFileSync(RIGSH, 'utf8');
    expect(src, 'the premise: rig.sh sets the depth on one line').toMatch(/^BYPASS_JSON_DEPTH=4$/m);
    fs.writeFileSync(path.join(d, 'rig.sh'), src.replace(/^BYPASS_JSON_DEPTH=4$/m, 'BYPASS_JSON_DEPTH=not-a-number'));
    const f = scen('scenarios', 'esc', [{ waitReady: 60 }], { launch: { args: ['--permission-mode', 'BYPASS'] } });
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('BYPASS', 'bypass\\u0050ermissions'));
    const run = (sh: string): number | null => spawnSyncGroup('bash', [sh, 'check-scenario', f], { encoding: 'utf8', timeout: 120_000 }).status;
    expect(run(RIGSH), 'the control: the rig as committed refuses it').toBe(2);
    expect(run(path.join(d, 'rig.sh'))).toBe(2);
  }, 60_000);

  // A backslash before ANY line terminator continues the line: JSON5's strings are JavaScript's, which join a lone CR,
  // U+2028 and U+2029 as well as LF and CRLF (review 1790 F2).
  it.each([
    ['a lone CR', '\r'],
    ['U+2028', '\u2028'],
    ['U+2029', '\u2029'],
  ])('a settings file whose mode continues past a backslash and %s is refused outside the rig\'s own scenarios-overlord (F2)', (_w, brk) => {
    const text = `{permissions: {defaultMode: "bypass\\${brk}Permissions"}}`;
    expect(() => JSON.parse(text), 'the premise: no strict JSON reader decodes it').toThrow();
    const f = scen('scenarios', 'brk', [{ waitReady: 60 }], { launch: { files: [{ in: 'cfg', path: 'settings.json', text }] } });
    hiddenFromTheOldScan(f);
    expect(rigsh(['check-scenario', f]).status).toBe(2);
  }, 60_000);

  // Every jq read of a scenario answers for its LAST JSON document, while load_launch reads them all, so a scenario file
  // is exactly one document or it is refused (review 1790 F1).
  it('a scenario file of two JSON documents is refused: the first one\'s reserved env name and bypass would reach the run unchecked (F1)', () => {
    const d = path.join(mkTmp('ccrc-dlg-w0-'), 'scenarios');
    fs.mkdirSync(d, { recursive: true });
    const file = (name: string, docs: object[]): string => {
      const f = path.join(d, name);
      fs.writeFileSync(f, docs.map((x) => JSON.stringify(x)).join('\n') + '\n');
      return f;
    };
    const first = { steps: [{ waitReady: 60 }], entries: [], launch: { env: { HOME: '/x' },
      files: [{ in: 'repo', path: '.claude/agents/r.md', text: frontmatter('"bypass\\\n  Permissions"') }] } };
    const last = { steps: [{ waitReady: 60 }], entries: [], settleS: '' };
    expect(rigsh(['check-scenario', file('first.json', [first])]).status, 'the premise: the first alone is refused').toBe(2);
    expect(rigsh(['check-scenario', file('two.json', [first, last])]).status).toBe(2);
  }, 60_000);

  it('the force-hook arm differs from its control only by FORCE and a paneSnap, and pins no setting source, so ccrc\'s hook is loaded (M6)', () => {
    const read = (n: string): Record<string, any> => JSON.parse(fs.readFileSync(path.join(RIG, 'scenarios-overlord', `${n}.json`), 'utf8'));
    const hook = read('ov-subagent-model-force-hook');
    const control = read('ov-subagent-model');
    expect(hook.launch.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE).toBe('1');
    expect(control.launch.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE).toBeUndefined();
    expect((hook.launch.args as string[]).filter((a) => /^--setting(s|-sources)\b/.test(a))).toEqual([]);
    const strip = (s: Record<string, any>): Record<string, any> => {
      const c = structuredClone(s);
      delete c.scenario;
      delete c.launch.env.CLAUDE_CODE_SUBAGENT_MODEL_FORCE;
      c.steps = (c.steps as object[]).filter((x) => !('paneSnap' in x));
      return c;
    };
    expect(strip(hook)).toEqual(strip(control));
  });

  it('the committed ov-door, which carries a bypass, passes where it sits and through a link to it; a copy elsewhere is refused (F3)', () => {
    const door = path.join(RIG, 'scenarios-overlord', 'ov-door.json');
    expect(fs.readFileSync(door, 'utf8'), 'the premise: ov-door carries a bypass').toMatch(BYPASS_RE);
    expect(rigsh(['check-scenario', door]).status).toBe(0);
    const d = path.join(mkTmp('ccrc-dlg-w0-'), 'server/test/delegation-rig/scenarios-overlord');
    fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(door, path.join(d, 'ov-door.json'));
    expect(rigsh(['check-scenario', path.join(d, 'ov-door.json')]).status, 'a copy').toBe(2);
    fs.symlinkSync(door, path.join(d, 'link.json'));
    expect(rigsh(['check-scenario', path.join(d, 'link.json')]).status, 'a link to the committed file is that file').toBe(0);
  }, 60_000);

  it('no file in the delegation corpus names a bypass flag', () => {
    for (const f of fs.readdirSync(path.join(RIG, 'scenarios')))
      expect(fs.readFileSync(path.join(RIG, 'scenarios', f), 'utf8')).not.toMatch(BYPASS_RE);
  });

  it('every committed scenarios-overlord file passes check-scenario and names both main-thread prompt shapes in mainMarker (F2)', () => {
    const dir = path.join(RIG, 'scenarios-overlord');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      expect(rigsh(['check-scenario', path.join(dir, f)]).status, f).toBe(0);
      const marker: unknown = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).mainMarker;
      expect(typeof marker, f).toBe('string');
      // The opening of the main thread's system prompt before 2.1.322 and on it (results note, Task 4).
      for (const shape of ['You are an interactive agent', 'You are an agent working with the user'])
        expect(new RegExp(marker as string).test(shape), `${f}: ${shape}`).toBe(true);
    }
  }, 600_000);

  it('the config-load scenarios approve the tail of the key rig_key makes, so a change to it fails here, not as a dialog mid-run (F16)', () => {
    const key = spawnSyncGroup('bash', ['-c', `${rigText('rig_key')}\nrig_key`], { encoding: 'utf8', timeout: 60_000 }).stdout;
    expect(key).toMatch(/^sk-ant-api03-/);
    for (const f of ['ov-config-load.json', 'ov-config-load-pinned.json']) {
      const s = JSON.parse(fs.readFileSync(path.join(RIG, 'scenarios-overlord', f), 'utf8'));
      const cj = (s.launch.files as Array<{ path: string; text: string }>).find((x) => x.path === '.claude.json');
      expect(cj, f).toBeDefined();
      expect(JSON.parse(cj!.text).customApiKeyResponses.approved, f).toEqual([key.slice(-20)]);
    }
  }, 60_000);

  it('launch_cmd quotes a launch value and substitutes only the five placeholders', () => {
    const line = launchLine({ args: ['--settings', '@RIG_CFG@/p.json; touch x'], env: { [firstEnvName()]: 'a b; touch y' } });
    expect(line).toContain(`${cfg}/p.json\\;\\ touch\\ x`);
    expect(line).toContain(`${firstEnvName()}=a\\ b\\;\\ touch\\ y`);
    expect(line).not.toMatch(/@RIG_[A-Z]+@/);
  }, 60_000);

  it('print-launch carries every checked flag, value and env name onto the command line (Review Focus 1)', () => {
    const env = { [firstEnvName()]: '@RIG_ROOT@/logs/emit.ndjson' };
    const line = launchLine({ args: ['--setting-sources', 'project', '--strict-mcp-config'], env });
    expect(line).toContain(' --setting-sources project --strict-mcp-config');
    expect(line).toContain(`${firstEnvName()}=${path.dirname(path.dirname(cfg))}/logs/emit.ndjson`);
  }, 60_000);

  it('cmd_setup merges launch.settings over the fixture and appends hooks, so ccrc\'s own hook stays; files land under cfg and repo', () => {
    launchLine({
      settings: { env: { W0_X: '1' }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node @RIG_STUBS@/emit-context.mjs' }] }] } },
      files: [{ in: 'cfg', path: 'skills/w0/SKILL.md', text: 'canary @RIG_REPO@' }, { in: 'repo', path: 'CLAUDE.md', text: 'W0', exec: true }],
    });
    const s = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
    expect(s.env).toMatchObject({ DISABLE_AUTOUPDATER: '1', W0_X: '1' });
    const ss = JSON.stringify(s.hooks.SessionStart);
    expect(ss).toContain('/session-hook.sh');
    expect(ss).toContain(`node ${RIG}/stubs/emit-context.mjs`);
    expect(s.permissions.defaultMode).toBe('default');
    const root = path.dirname(path.dirname(cfg));
    expect(fs.readFileSync(path.join(cfg, 'skills/w0/SKILL.md'), 'utf8')).toBe(`canary ${root}/repo`);
    expect(fs.statSync(path.join(root, 'repo/CLAUDE.md')).mode & 0o111).not.toBe(0);
  }, 60_000);

  it('a launch file path may name @RIG_PROJECT@, the project directory Claude Code derives from the fixture repo; cfg2 files wait for swapConfig', () => {
    launchLine({ files: [{ in: 'cfg', path: 'projects/@RIG_PROJECT@/memory/MEMORY.md', text: 'W0-MEM-A' },
      { in: 'cfg2', path: 'projects/@RIG_PROJECT@/memory/MEMORY.md', text: 'W0-MEM-B' }] });
    const root = path.dirname(path.dirname(cfg));
    const project = path.join(root, 'repo').replace(/[^A-Za-z0-9]/g, '-');
    expect(fs.readFileSync(path.join(cfg, 'projects', project, 'memory/MEMORY.md'), 'utf8')).toBe('W0-MEM-A');
    expect(fs.existsSync(path.join(root, 'fixhome/cfg2')), 'cfg2 is written by swapConfig, never at setup').toBe(false);
  }, 60_000);

  it.each([
    ['a placeholder other than @RIG_PROJECT@ in a path', { launch: { files: [{ in: 'cfg', path: 'projects/@RIG_ROOT@/x', text: '' }] } }],
    ['a paneSnap name with a slash', { steps: [{ paneSnap: 'a/b' }] }],
  ])('check-scenario refuses %s, exit 2', (_w, top) => {
    expect(rigsh(['check-scenario', scen('scenarios-overlord', 'bad2', [{ waitReady: 60 }], top)]).status).toBe(2);
  }, 60_000);

  it('check-scenario accepts a paneSnap step and a cfg2 file', () => {
    const f = scen('scenarios-overlord', 'ps', [{ paneSnap: 'after-model' }], { launch: { files: [{ in: 'cfg2', path: 'CLAUDE.md', text: 'x' }] } });
    expect(rigsh(['check-scenario', f]).status).toBe(0);
  }, 60_000);

  it('print-launch bounds the binary by the scenario\'s capS, and by 1200 s without one (F10)', () => {
    expect(launchLine({ args: ['--strict-mcp-config'] }, { capS: 600 })).toMatch(/timeout -k 10 600 /);
    expect(launchLine({ args: ['--strict-mcp-config'] })).toMatch(/timeout -k 10 1200 /);
  }, 60_000);

  it('the usage names print-launch, and the header still ends on its last line', () => {
    const r = rigsh(['bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('rig.sh print-launch <version> <scenario.json> <root>');
    expect(r.stderr).toContain('(and a box with no /proc, where that cannot be measured, keeps them)');
    expect(r.stderr).not.toContain('set -euo pipefail');
  }, 60_000);
});

/** rig.sh's own run_steps and run_opts, and what they call, cut from its text and run under its own strictness in `cwd`,
 *  with tmux, the pane, the ready wait, the session id and the launch line stubbed (T appends its argv to
 *  <root>/tmux-calls; pane prints W0-PANE-TEXT; current_sid prints sid-w0; launch_cmd prints LAUNCH and its arguments).
 *  `scenario` is the run's SCEN; `cfg` names files to place under the run's config first. After the steps the script
 *  prints the working directory, CFG and the run options. Nothing starts a process but bash, jq and the coreutils. */
function runSteps(scenario: object, cfgFiles: Record<string, string> = {}, env: Record<string, string> = {}): { status: number | null; stderr: string; root: string; out: Record<string, string> } {
  const root = fs.realpathSync(mkTmp('ccrc-dlg-steps-'));
  const cwd = fs.realpathSync(mkTmp('ccrc-dlg-cwd-'));
  for (const [rel, text] of Object.entries(cfgFiles)) {
    fs.mkdirSync(path.dirname(path.join(root, 'fixhome/cfg', rel)), { recursive: true });
    fs.writeFileSync(path.join(root, 'fixhome/cfg', rel), text);
  }
  fs.mkdirSync(path.join(root, 'fixhome/cfg'), { recursive: true });
  const scenFile = path.join(root, 'scenario.json');
  fs.writeFileSync(scenFile, JSON.stringify({ entries: [], ...scenario }));
  const script = ['set -euo pipefail', `HERE=${shq(RIG)}`,
    rigText('SESSION', 'RUN_CAP_S', 'launch_subst', 'apply_launch_files', 'timing', 'note', 'snapshot', 'sessions_snap', 'run_opts', 'run_steps'),
    'T() { printf \'%s\\n\' "$*" >> "$RUN_R/tmux-calls"; }', 'pane() { printf \'W0-PANE-TEXT\\n\'; }', 'wait_ready() { return 0; }',
    'current_sid() { printf sid-w0; }', 'launch_cmd() { printf LAUNCH; printf \' %s\' "$@"; }',
    `RUN_R=${shq(root)} RUN_H=${shq(path.join(root, 'fixhome'))} CFG=${shq(path.join(root, 'fixhome/cfg'))} SCEN=${shq(scenFile)} SOCK=dlgx`,
    'run_opts', 'run_steps',
    'printf \'cwd=%s\\ncfg=%s\\ntiming=%s\\nrequests=%s\\ncap=%s\\n\' "$(pwd -P)" "$CFG" "$TIMING" "$REQUESTS" "$RUN_CAP_S"'].join('\n');
  const r = spawnSyncGroup('bash', ['-c', script], { encoding: 'utf8', cwd, env: { ...process.env, ...env }, timeout: 60_000 });
  const out = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  if (r.status === 0) expect(out.cwd, 'the steps leave the working directory where it was (F5)').toBe(cwd);
  return { status: r.status, stderr: r.stderr, root, out };
}
const readIn = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), 'utf8');

describe('rig.sh\'s run-time verbs, run from its own text with tmux stubbed (F5, F10)', () => {
  it('run_opts reads capS, timing and requests; without them the cap is 1200 and both switches are off', () => {
    expect(runSteps({ steps: [], capS: 600, timing: true, requests: true }).out).toMatchObject({ timing: '1', requests: '1', cap: '600' });
    expect(runSteps({ steps: [] }).out).toMatchObject({ timing: '0', requests: '0', cap: '1200' });
  }, 60_000);

  // `date +%s%3N` is GNU date's (the rig's step timer); the rig's timed runs are Linux's.
  it.skipIf(!LINUX)('timing: true writes each step\'s start and waitReady\'s elapsed milliseconds to the run\'s own timing file, never to notes', () => {
    const on = runSteps({ steps: [{ waitReady: 5 }, { sleep: 0 }], timing: true });
    expect(on.status, on.stderr).toBe(0);
    const lines = readIn(on.root, 'timing').trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^step 1 waitReady start \d{13}$/);
    expect(lines[1]).toMatch(/^step 1 waitReady elapsed \d+$/);
    expect(lines[2]).toMatch(/^step 2 sleep start \d{13}$/);
    expect(fs.existsSync(path.join(on.root, 'notes')), 'no notes line').toBe(false);
    const off = runSteps({ steps: [{ waitReady: 5 }, { sleep: 0 }] });
    expect(off.status, off.stderr).toBe(0);
    expect(fs.existsSync(path.join(off.root, 'timing')), 'no timing file without timing: true').toBe(false);
  }, 60_000);

  it('paneSnap writes the pane\'s text to snapshots/<name>/pane', () => {
    const r = runSteps({ steps: [{ paneSnap: 'after-model' }] });
    expect(r.status, r.stderr).toBe(0);
    expect(readIn(r.root, 'snapshots/after-model/pane')).toBe('W0-PANE-TEXT\n');
  }, 60_000);

  it('sessionsSnap copies the live-session records and lists each transcript with its size in bytes, and leaves the working directory alone (F5)', () => {
    const r = runSteps({ steps: [{ sessionsSnap: 'before' }] },
      { 'sessions/4242.json': '{"sessionId":"s-1"}', 'projects/p-a/s-1.jsonl': '12345', 'projects/p-a/s-1/subagents/a.jsonl': 'x' });
    expect(r.status, r.stderr).toBe(0);
    expect(readIn(r.root, 'snapshots/before/sessions/4242.json')).toBe('{"sessionId":"s-1"}');
    expect(readIn(r.root, 'snapshots/before/transcripts')).toBe('p-a/s-1.jsonl\t5\n');
  }, 60_000);

  // BSD find (macOS) has no `-printf`, and the list came out empty there while Linux's held the line (D-8343). This
  // `find` refuses it as BSD's does and runs the real one otherwise, so Linux shows the Darwin answer.
  it('sessionsSnap lists the transcripts with a find that has no -printf, as macOS\'s has none (D-8343)', () => {
    const shims = fs.realpathSync(mkTmp('ccrc-dlg-bsdfind-'));
    const real = spawnSync('bash', ['-c', 'command -v find'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(shims, 'find'), ['#!/bin/bash',
      'for a in "$@"; do case $a in -printf|-fprintf) printf \'find: %s: unknown primary or operator\\n\' "$a" >&2; exit 1 ;; esac; done',
      `exec ${shq(real)} "$@"`, ''].join('\n'), { mode: 0o755 });
    const r = runSteps({ steps: [{ sessionsSnap: 'before' }] },
      { 'projects/p-a/s-1.jsonl': '12345', 'projects/p-b/s-2.jsonl': '', 'projects/p-a/s-1/subagents/a.jsonl': 'x' },
      { PATH: `${shims}:${process.env.PATH ?? ''}` });
    expect(r.status, r.stderr).toBe(0);
    expect(readIn(r.root, 'snapshots/before/transcripts')).toBe('p-a/s-1.jsonl\t5\np-b/s-2.jsonl\t0\n');
  }, 60_000);

  it('swapConfig copies the config to cfg2, writes the cfg2 launch files there, and moves CFG to it', () => {
    const r = runSteps({ steps: [{ swapConfig: true }], launch: { files: [{ in: 'cfg2', path: 'CLAUDE.md', text: 'W0-CFG2 @RIG_REPO@' },
      { in: 'cfg', path: 'NOT-HERE.md', text: 'x' }] } }, { 'settings.json': '{"a":1}' });
    expect(r.status, r.stderr).toBe(0);
    expect(readIn(r.root, 'fixhome/cfg2/settings.json')).toBe('{"a":1}');
    expect(readIn(r.root, 'fixhome/cfg2/CLAUDE.md')).toBe(`W0-CFG2 ${r.root}/repo`);
    expect(fs.existsSync(path.join(r.root, 'fixhome/cfg2/NOT-HERE.md')), 'a cfg file is setup\'s, not the swap\'s').toBe(false);
    expect(r.out.cfg).toBe(path.join(r.root, 'fixhome/cfg2'));
  }, 60_000);

  it('relaunch respawns the pane: true resumes the session, fork adds --fork-session, fresh names no session', () => {
    const r = runSteps({ steps: [{ relaunch: true }, { relaunch: { mode: 'fork' } }, { relaunch: { mode: 'fresh' } }] });
    expect(r.status, r.stderr).toBe(0);
    expect(readIn(r.root, 'tmux-calls').trim().split('\n')).toEqual([
      'dlgx respawn-pane -k -t cc-rig-hookcap bash -c LAUNCH --resume sid-w0',
      'dlgx respawn-pane -k -t cc-rig-hookcap bash -c LAUNCH --resume sid-w0 --fork-session',
      'dlgx respawn-pane -k -t cc-rig-hookcap bash -c LAUNCH',
    ]);
  }, 60_000);

  it('collect copies the run\'s timing file, the mock\'s request dumps and the stubs\' logs into the bundle', () => {
    const root = fs.realpathSync(mkTmp('ccrc-dlg-collect-'));
    const out = path.join(mkTmp('ccrc-dlg-collect-out-'), 'bundle');
    for (const [rel, text] of [['timing', 'step 1 waitReady start 1\n'], ['reqs/0001-main.json', '{"n":1}'], ['logs/emit.ndjson', '{}\n']] as const) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    const script = ['set -euo pipefail', rigText('g', 'collect'), 'curl() { return 7; }',
      `RUN_R=${shq(root)} RUN_H=${shq(path.join(root, 'fixhome'))} VER=2.1.0 VERSIONS=/nonexistent SCEN=/x/ov-t.json PORT=0`,
      `collect ${shq(out)}`].join('\n');
    const r = spawnSyncGroup('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env }, timeout: 60_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(path.join(out, 'timing'), 'utf8')).toBe('step 1 waitReady start 1\n');
    expect(fs.readFileSync(path.join(out, 'reqs/0001-main.json'), 'utf8')).toBe('{"n":1}');
    expect(fs.readFileSync(path.join(out, 'logs/emit.ndjson'), 'utf8')).toBe('{}\n');
  }, 60_000);
});

const STUBS = path.join(RIG, 'stubs');
/** Run one stub with `args`, `stdin` and extra env; stdout and the exit status. */
function runStub(stub: string, args: string[], stdin: string, env: NodeJS.ProcessEnv = {}): { stdout: string; status: number | null } {
  const r = spawnSync(process.execPath, [path.join(STUBS, stub), ...args], { input: stdin, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30_000 });
  return { stdout: r.stdout, status: r.status };
}
const run = (stub: string, args: string[], stdin: string): string => runStub(stub, args, stdin).stdout;
const runRc = (stub: string, stdin: string): number | null => runStub(stub, [], stdin).status;
/** The door stub fed one JSON-RPC 2.0 request line per call (id = its index), stdin then closed: its replies, in order, and its log. */
async function door(calls: Array<string | [string, object]>, env: NodeJS.ProcessEnv): Promise<{ replies: Array<Record<string, any>>; log: string }> {
  const log = path.join(mkTmp('ccrc-dlg-door-'), 'door.ndjson');
  const input = calls.map((c, id) => {
    const [method, params] = typeof c === 'string' ? [c, {}] : c;
    return JSON.stringify({ jsonrpc: '2.0', id, method, params });
  }).join('\n') + '\n';
  const r = runStub('door-stub.mjs', [], input, { ...env, DOOR_LOG: log });
  return { replies: r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)), log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}
/** statusline-capture.mjs fed `payload`: its log's last line, parsed. */
function capture(payload: object): Record<string, unknown> {
  const log = path.join(mkTmp('ccrc-dlg-sl-'), 'status.ndjson');
  runStub('statusline-capture.mjs', [], JSON.stringify(payload), { RIG_STATUS_LOG: log });
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return JSON.parse(lines[lines.length - 1] as string);
}

describe('the rig\'s W0 stubs (W0 Task 3)', () => {
  it('the door stub lists card, read and act, and logs the nonce as present, never its value', async () => {
    const { replies, log } = await door(['initialize', 'tools/list', ['tools/call', { name: 'card', arguments: {} }]],
      { DOOR_NONCE: 'n-7f3a' });
    expect(replies[1]!.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['act', 'card', 'read']);
    expect(JSON.stringify(replies[2])).toContain('W0-CARD-CANARY');
    expect(log).toContain('"nonce":"present"');
    expect(log).not.toContain('n-7f3a');
  }, 60_000);

  it('the door stub answers read with a record and act with ok, and logs the nonce absent when none is set', async () => {
    const { replies, log } = await door(['initialize', ['tools/call', { name: 'read', arguments: {} }], ['tools/call', { name: 'act', arguments: {} }]], { DOOR_NONCE: '' });
    expect(replies[1]!.result.content[0].text).toBe('{"kind":"record","id":"r-1"}');
    expect(replies[2]!.result.content[0].text).toBe('ok');
    expect(log).toContain('"nonce":"absent"');
  }, 60_000);

  it.each([9951, 10000, 10001, 12000])('emit-context prints exactly %i characters between its canaries', (n) => {
    const t = JSON.parse(run('emit-context.mjs', ['--event', 'SessionStart', '--chars', String(n)], '{"source":"startup"}'))
      .hookSpecificOutput.additionalContext as string;
    expect(t.length).toBe(n);
    expect(t.startsWith(`W0-HEAD-${n}-`) && t.endsWith(`-W0-TAIL-${n}`)).toBe(true);
  }, 60_000);

  it('emit-context\'s wide filler is two UTF-8 bytes a character, and its log names the event and the source', () => {
    const log = path.join(mkTmp('ccrc-dlg-emit-'), 'emit.ndjson');
    const out = runStub('emit-context.mjs', ['--event', 'SessionStart', '--chars', '6000', '--fill', 'wide'], '{"source":"clear"}', { RIG_EMIT_LOG: log }).stdout;
    const t = JSON.parse(out).hookSpecificOutput.additionalContext as string;
    expect(t.length).toBe(6000);
    expect(Buffer.byteLength(t, 'utf8')).toBeGreaterThan(11_900);
    expect(JSON.parse(fs.readFileSync(log, 'utf8').trim())).toMatchObject({ event: 'SessionStart', source: 'clear' });
  }, 60_000);

  it('emit-context --tag-source puts the payload\'s source inside both canaries, so each start is told apart in a request', () => {
    const t = JSON.parse(run('emit-context.mjs', ['--event', 'SessionStart', '--chars', '200', '--tag-source'], '{"source":"compact"}'))
      .hookSpecificOutput.additionalContext as string;
    expect(t.length).toBe(200);
    expect(t.startsWith('W0-HEAD-200-compact-') && t.endsWith('-compact-W0-TAIL-200')).toBe(true);
  }, 60_000);

  it('emit-context --log-payload logs the payload\'s keys, token-like values as they are, and no free text', () => {
    const log = path.join(mkTmp('ccrc-dlg-emit-'), 'emit.ndjson');
    runStub('emit-context.mjs', ['--event', 'PostModelSwitch', '--chars', '100', '--log-payload'],
      JSON.stringify({ model: 'claude-sonnet-5-5', prompt: 'a private sentence', n: 3, cwd: '/w0/x' }), { RIG_EMIT_LOG: log });
    const o = JSON.parse(fs.readFileSync(log, 'utf8').trim());
    expect(o.payload).toEqual({ model: 'claude-sonnet-5-5', prompt: '<string>', n: 3, cwd: '<string>' });
  }, 60_000);

  it('precompact-refuse blocks auto and passes manual', () => {
    expect(runRc('precompact-refuse.mjs', '{"trigger":"auto"}')).toBe(2);
    expect(runRc('precompact-refuse.mjs', '{"trigger":"manual"}')).toBe(0);
  }, 60_000);

  it('statusline capture keeps numbers and key paths, never a string value but the model id', () => {
    const o = capture({ model: { id: 'm-1', display_name: 'private-x' }, cwd: '/w0/cwd/p',
      context_window: { total_input_tokens: 1200, context_window_size: 200000 } });
    expect(o['context_window.total_input_tokens']).toBe(1200);
    expect(o['model.id']).toBe('m-1');
    expect(o['cwd']).toBe('<string>');
    expect(JSON.stringify(o)).not.toMatch(/private-x|\/w0\/cwd/);
  }, 60_000);
});

/** Start mockapi.mjs on `script`, with the outer MOCK_LOG, MOCK_REQDIR and MOCK_MAIN_MARKER removed and `extra` added, run
 *  `fn` with its base URL, and kill it. */
async function withMock<T>(script: object, fn: (url: string) => Promise<T>, extra: NodeJS.ProcessEnv = {}): Promise<T> {
  const file = path.join(mkTmp('ccrc-dlg-mock-'), 'script.json');
  fs.writeFileSync(file, JSON.stringify(script));
  const base: NodeJS.ProcessEnv = { ...process.env };
  delete base.MOCK_LOG; delete base.MOCK_REQDIR; delete base.MOCK_MAIN_MARKER;
  const child = spawn(process.execPath, [path.join(RIG, 'mockapi.mjs')],
    { env: { ...base, MOCK_PORT: '0', MOCK_SCRIPT: file, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise<string>((resolve, reject) => {
      let out = '';
      const t = setTimeout(() => reject(new Error('mock did not start')), 10_000);
      child.stdout!.on('data', (b: Buffer) => { out += b.toString(); const m = /listening 127\.0\.0\.1:(\d+)/.exec(out); if (m) { clearTimeout(t); resolve(m[1] as string); } });
    });
    return await fn(`http://127.0.0.1:${port}`);
  } finally { child.kill('SIGKILL'); }
}
/** One streamed request offering a tool, under `system`: the status, and the text deltas in order. */
async function ask(url: string, system: string): Promise<{ status: number; deltas: string[] }> {
  const r = await fetch(`${url}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: true, model: 'm', tools: [{ name: 'Bash' }], system, messages: [{ role: 'user', content: 'x' }] }) });
  const body = await r.text();
  if (r.status !== 200) return { status: r.status, deltas: [] };
  return { status: r.status, deltas: body.split('\n\n').filter((b) => b.includes('text_delta'))
    .map((b) => JSON.parse(b.slice(b.indexOf('data: ') + 6)).delta.text as string) };
}
// The opening of the main thread's system prompt before 2.1.322, and on it (results note, Task 4).
const MAIN_OLD = 'You are an interactive agent that helps users.';
const MAIN_NEW = 'You are an agent working with the user toward their goals.';

describe('mockapi.mjs: W0\'s padded reply and main-thread marker (W0 Task 5; F2, F16)', () => {
  it('appends exactly `pad` filler characters to an entry\'s text and streams it in `chunk_chars` pieces', async () => {
    const { deltas } = await withMock({ entries: [{ match: 'any', text: 'W0-PAD', pad: 1000, chunk_chars: 100, chunk_ms: 0 }] }, (u) => ask(u, MAIN_OLD));
    expect(deltas.join('').length).toBe('W0-PAD'.length + 1000);
    expect(deltas.join('').startsWith('W0-PAD')).toBe(true);
    expect(deltas).toHaveLength(Math.ceil(1006 / 100));
  }, 60_000);

  it.each([
    ['a chunk_chars that is not a number', { text: 'W0', chunk_chars: 'x' }],
    ['a chunk_chars that is not an integer', { text: 'W0', chunk_chars: 2.5 }],
    ['a pad that is not a whole number', { text: 'W0', pad: -3 }],
    ['a pad on a blocks entry, which would drop it', { blocks: [{ text: 'W0' }], pad: 100 }],
    ['a pad over 16 MB (M7)', { text: 'W0', pad: 16 * 1024 * 1024 + 1, chunk_chars: 32 * 1024 * 1024 }],
  ])('refuses %s: HTTP 500, never a silently short reply (F16)', async (_w, entry) => {
    const { status } = await withMock({ entries: [{ match: 'any', chunk_ms: 0, ...entry }] }, (u) => ask(u, MAIN_OLD));
    expect(status).toBe(500);
  }, 60_000);

  it.each([0, -1])('refuses a chunk_chars of %i at once, before it loops (F16)', async (n) => {
    const { status } = await withMock({ entries: [{ match: 'any', text: 'W0', chunk_chars: n, chunk_ms: 0 }] }, (u) => ask(u, MAIN_OLD));
    expect(status).toBe(500);
  }, 60_000);

  it('a script\'s mainMarker that is no regular expression is answered HTTP 500, not the default marker in silence (M1)', async () => {
    const { status } = await withMock({ entries: [{ label: 'm', text: 'W0-MAIN', chunk_ms: 0 }], mainMarker: '(' }, (u) => ask(u, MAIN_OLD));
    expect(status).toBe(500);
  }, 60_000);

  it('a script\'s mainMarker decides the main thread, over MOCK_MAIN_MARKER and the default (F2)', async () => {
    const entries = [{ label: 'm', text: 'W0-MAIN', chunk_ms: 0 }];
    const marker = 'You are (an interactive agent|an agent working with the user)';
    expect((await withMock({ entries }, (u) => ask(u, MAIN_NEW))).deltas.join(''), 'the default misses the new shape').toBe('(mock default reply)');
    expect((await withMock({ entries, mainMarker: marker }, (u) => ask(u, MAIN_NEW))).deltas.join('')).toBe('W0-MAIN');
    expect((await withMock({ entries, mainMarker: marker }, (u) => ask(u, MAIN_NEW), { MOCK_MAIN_MARKER: 'nothing matches this' }))
      .deltas.join(''), 'the script wins over MOCK_MAIN_MARKER').toBe('W0-MAIN');
    expect((await withMock({ entries, mainMarker: marker }, (u) => ask(u, MAIN_OLD))).deltas.join('')).toBe('W0-MAIN');
  }, 60_000);
});
