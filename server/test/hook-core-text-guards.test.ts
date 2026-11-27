// The Go-side twins of the hook's TEXT guards (Go core wave 2, Task 9a; inventory §5). Each one is the Go side of a guard
// that scans the bash hook, so the switch to `go` leaves no guard blind:
//   - the event set: the installer's EVENTS_JSON (+ PreToolUse) = shared/hook-events.ts = the generated `vocab.HookEvents`
//     = the Go dispatch (`attention.Classify`'s arms; its own test in core/internal/domain/attention holds the last two);
//   - single-definition over core/: a vocabulary the generator owns is spelled once, in `vocab_gen.go`;
//   - tmux-socket-census over core/: Go reads the socket file and its name rule from the vocabulary, and nothing but the
//     tmux adapter starts `tmux`;
//   - `_api_server_cap`'s generator keeps its source, the bash hook, while the bash hook ships;
//   - the managed hook's recognisers: the installer's `own`, doctor's hooked test and `DR_OWN_HOOK_JQ` all accept the bash
//     command AND the core's, so a box in either mode is hooked and a sweep leaves no orphan.
// Each is measured red when its guard is removed (the PR's note names the mutation).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HOOK_EVENTS } from '../../shared/hook-events.js';
import { TMUX_SOCKET_FILE, TMUX_SOCKET_NAME_RE } from '../../shared/tmux-target.js';
import { approvalClass, rootsForChild } from '../src/coord/approvalguard.js';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string): string => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Every Go source under core/ that is not a test or a fixture: what ships in the binary. */
function goSources(dir = 'core'): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'testdata' && e.name !== 'bin') out.push(...goSources(rel)); }
    else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) out.push(rel);
  }
  return out;
}
/** A Go line with its `//` tail dropped, so prose about a name never counts. */
const code = (t: string): string => t.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
const VOCAB = 'core/internal/kernel/vocab/vocab_gen.go';

describe('the event set: installer = HOOK_EVENTS = vocab.HookEvents', () => {
  const installerEvents = (): string[] => [...(JSON.parse(/^EVENTS_JSON='(.*)'$/m.exec(read('ccd/install-session-hooks.sh'))![1]!) as string[]), 'PreToolUse'];
  const vocabEvents = (): string[] => {
    const m = /^var HookEvents = \[\]string\{\n([\s\S]*?)^\}/m.exec(read(VOCAB));
    expect(m, 'vocab_gen.go declares HookEvents').toBeTruthy();
    return [...m![1]!.matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]!);
  };
  it('the generated Go list is the L0 union, in order (the generator reads the owner, never a copy)', () => {
    expect(vocabEvents()).toEqual([...HOOK_EVENTS]);
  });
  it('the installer registers exactly the vocabulary: a set, both directions', () => {
    expect([...installerEvents()].sort()).toEqual([...vocabEvents()].sort());
  });
  it('CONTROL: the extraction sees a dropped event', () => {
    expect([...installerEvents().filter((e) => e !== 'SessionStart')].sort()).not.toEqual([...vocabEvents()].sort());
  });
});

describe('tmux-socket-census over core/: the Go hook reads the lookup from the vocabulary', () => {
  it('the generated constants are shared/tmux-target.ts\'s', () => {
    const v = read(VOCAB);
    expect(/^const TmuxSocketFile = "(.*)"$/m.exec(v)![1]).toBe(TMUX_SOCKET_FILE);
    expect(JSON.parse(`"${/^const TmuxSocketNameRe = "(.*)"$/m.exec(v)![1]}"`)).toBe(TMUX_SOCKET_NAME_RE.source);
  });
  it('the tmux adapter takes both from the vocabulary', () => {
    const t = code(read('core/internal/adapter/tmux/tmux.go'));
    expect(t).toContain('vocab.TmuxSocketFile');
    expect(t).toContain('vocab.TmuxSocketNameRe');
  });
  it('no Go file but the tmux adapter starts the program: an exec of "tmux" is the lookup\'s alone', () => {
    const hits = goSources().filter((f) => /exec\.Command(?:Context)?\([^)]*"tmux"/.test(code(read(f)))
      || /\[\]string\{"tmux"/.test(code(read(f)))).sort();
    expect(hits).toEqual(['core/internal/adapter/tmux/tmux.go']);
  });
});

describe('_api_server_cap\'s generator keeps its source: the bash hook, while the bash hook ships', () => {
  it('the apicap row renders from the sibling session-hook.sh, which still defines _hook_server_cap', () => {
    expect(read('shared/hook-helpers.mjs')).toMatch(/detect: '# ── BEGIN GENERATED SERVER-CAP READER', source: 'hook', file: 'ccd\/ccd'/);
    expect(read('ccd/session-hook.sh')).toMatch(/^_hook_server_cap\(\) \{/m);
  });
  it('the Go hook states no second generator source: nothing under core/ defines `_hook_server_cap`', () => {
    expect(goSources().filter((f) => code(read(f)).includes('_hook_server_cap'))).toEqual([]);
  });
  it('the hook row still owns the whole bash file, so the generator\'s source is the table\'s own', () => {
    const t = JSON.parse(read('core/entries.json')) as { entries: { hook: { owns: string[] } } };
    expect(t.entries.hook.owns).toEqual(['ccd/session-hook.sh']);
  });
});

describe('the managed hook\'s recognisers accept both commands (the bash hook\'s and the core\'s)', () => {
  const BASH_CMD = 'bash "$HOME/.cc-sessions/session-hook.sh"';
  const GO_CMD = '"$HOME/.local/libexec/ccrc/core/ccrc-core" hook';
  const FOREIGN = ['/home/u/.project-w/foreign.sh', "'/home/u/.claude/skills/x/cron-upload.sh' --hook", 'bash "$HOME/.cc-sessions/notify.sh"'];
  const jqOwn = (def: string, command: string): boolean =>
    execFileSync('jq', ['-n', '-r', `${def} {command: $c} | ownhook`, '--arg', 'c', command], { encoding: 'utf8' }).trim() === 'true';

  const installerOwn = (): string => {
    const m = /^JQ_UNMANAGED='(def own: [^\n]*)\n/m.exec(read('ccd/install-session-hooks.sh'));
    expect(m, 'the installer defines `own`').toBeTruthy();
    return m![1]!.replace(/^def own:/, 'def ownhook:');
  };
  const doctorOwn = (): string => {
    const m = /^DR_OWN_HOOK_JQ='(def ownhook: [^\n]*?)'$/m.exec(read('ccd/ccrc-doctor-checks'));
    expect(m, 'doctor defines DR_OWN_HOOK_JQ').toBeTruthy();
    return m![1]!;
  };
  const doctorHookedGlob = (): string => {
    const m = /case "\$line" in ([^)]*)\) hooked=1; break ;; esac/.exec(read('ccd/ccrc-doctor-checks'));
    expect(m, 'doctor\'s reachability test').toBeTruthy();
    return m![1]!;
  };
  /** Doctor's `case "$line" in <patterns>) hooked=1` over one settings line, run by bash itself. */
  const hooked = (line: string): boolean =>
    execFileSync('bash', ['-c', `case "$1" in ${doctorHookedGlob()}) echo yes ;; *) echo no ;; esac`, '_', line], { encoding: 'utf8' }).trim() === 'yes';

  it.each([['the installer\'s own', installerOwn], ['doctor\'s DR_OWN_HOOK_JQ', doctorOwn]] as const)('%s: both commands are ccrc\'s, a foreign one is not', (_n, def) => {
    expect(jqOwn(def(), BASH_CMD)).toBe(true);
    expect(jqOwn(def(), GO_CMD)).toBe(true);
    expect(jqOwn(def(), 'bash "$HOME/.old-location/session-hook.sh"')).toBe(true);
    expect(jqOwn(def(), '"C:/Users/u/.local/libexec/ccrc/core/ccrc-core.exe" hook')).toBe(true);
    for (const f of FOREIGN) expect(jqOwn(def(), f), f).toBe(false);
  });
  it('doctor\'s reachability test reads a settings line naming either command, and not a foreign one', () => {
    expect(hooked(`        "command": ${JSON.stringify(BASH_CMD)},`)).toBe(true);
    expect(hooked(`        "command": ${JSON.stringify(GO_CMD)},`)).toBe(true);
    for (const f of FOREIGN) expect(hooked(`        "command": ${JSON.stringify(f)},`), f).toBe(false);
  });
  it('the installer registers exactly the two commands tested here', () => {
    const src = read('ccd/install-session-hooks.sh');
    expect(/^HOOK_CMD='(.*)'$/m.exec(src)![1]).toBe(BASH_CMD);
    expect(/^HOOK_CMD_GO='(.*)'$/m.exec(src)![1]).toBe(GO_CMD);
  });
});

describe('every deviation slug the plan records is cited at a code site under core/ (Task 6 N2)', () => {
  const PLAN = 'docs/superpowers/plans/2026-11-24-ccrc-go-core-w2-hook.md';
  const slugs = (text: string): string[] => {
    const sec = /^## Deviations found\n([\s\S]*?)^## /m.exec(text)?.[1] ?? '';
    return [...sec.matchAll(/^- `(D-TBD-go-hook-[a-z0-9-]+)`/gm)].map((m) => m[1]!);
  };
  /** Every Go file under core/, tests included: a slug may be cited where its behaviour is pinned. */
  const goAll = (dir = 'core'): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? (e.name === 'bin' ? [] : goAll(`${dir}/${e.name}`)) : e.name.endsWith('.go') ? [`${dir}/${e.name}`] : []));
  const cited = (all: readonly string[]): Set<string> => {
    const out = new Set<string>();
    for (const f of all) for (const m of read(f).matchAll(/D-TBD-go-hook-[a-z0-9-]+/g)) out.add(m[0]);
    return out;
  };
  it('the plan records the slugs (a floor, so an emptied section cannot pass)', () => {
    expect(slugs(read(PLAN)).length).toBeGreaterThanOrEqual(46);
  });
  it('each is named in a Go file under core/', () => {
    const have = cited(goAll());
    expect(slugs(read(PLAN)).filter((s) => !have.has(s))).toEqual([]);
  });
  it('and the other way: every slug a code site names is one the plan records (a short spelling is no slug)', () => {
    const recorded = new Set(slugs(read(PLAN)));
    expect([...cited(goAll())].filter((s) => !recorded.has(s)).sort()).toEqual([]);
  });
  it('CONTROL: the reverse check finds a code slug the plan does not record', () => {
    const recorded = new Set(slugs(read(PLAN)));
    expect(['D-TBD-go-hook-ctread'].filter((s) => !recorded.has(s))).toEqual(['D-TBD-go-hook-ctread']);
  });
  it('CONTROL: a slug no Go file names is found missing', () => {
    expect(['D-TBD-go-hook-no-such-slug'].filter((s) => !cited(goAll()).has(s))).toEqual(['D-TBD-go-hook-no-such-slug']);
  });
});

describe('the `hook` row name is spelled several times and tied here (Task 9a review N1)', () => {
  const ROW = 'hook';
  it('entries.json, the installer\'s HOOK_ENTRY, the core\'s kernel.HookEntry and the launcher\'s ccd-go-off question all say hook', () => {
    expect(Object.keys((JSON.parse(read('core/entries.json')) as { entries: object }).entries)).toContain(ROW);
    expect(/^HOOK_ENTRY = '([a-z]+)'/m.exec(read('ccd/ccd-entry-install.py'))![1]).toBe(ROW);
    expect(/^const HookEntry = "([a-z]+)"/m.exec(read('core/internal/kernel/entries.go'))![1]).toBe(ROW);
    expect(read('ccd/ccd-entry.py')).toContain(`core_off(home, '${ROW}')`);
    expect(read('core/cmd/ccrc-core/main.go')).toContain('GoOff(h, kernel.HookEntry)');
  });
});

describe('every writer of the hook command spells the installer\'s two commands (Task 9a review F1)', () => {
  const BASH_CMD = 'bash "$HOME/.cc-sessions/session-hook.sh"';
  const GO_CMD = '"$HOME/.local/libexec/ccrc/core/ccrc-core" hook';
  it('ccd\'s surfaced-profile rendering swaps the row\'s bash command for exactly the installer\'s go command', () => {
    const ccd = read('ccd/ccd');
    expect(/^HOOK_COMMAND_BASH='(.*)'$/m.exec(ccd)![1]).toBe(BASH_CMD);
    expect(/printf '%s' '(.*ccrc-core" hook)'$/m.exec(ccd)![1]).toBe(GO_CMD);
    expect(ccd).toContain('--ccrc-entry-hook-mode');
  });
  it('the row (the JSON file and the TypeScript constant) stays the bash command, so the digest is the same on both sides', () => {
    expect(read('server/src/continuity/launchProfile.ts')).toContain(`LAUNCH_HOOK_COMMAND = '${BASH_CMD}'`);
    const commands = read('ccd/lib/launch-profiles.json').split('\n').filter((l) => l.includes(`"command": ${JSON.stringify(BASH_CMD)}`));
    expect(commands.length).toBeGreaterThan(10);
  });
});

describe('the core binary is protected as session-hook.sh is (Task 9a review F2)', () => {
  const GO_CMD = '"$HOME/.local/libexec/ccrc/core/ccrc-core" hook';
  it('an edit or a shell write of the very path HOOK_CMD_GO registers is forbidden to a child', () => {
    const rel = /\$HOME(\/\.local\/libexec\/ccrc\/core\/ccrc-core)/.exec(GO_CMD)![1]!;
    const home = '/rig/home';
    const wt = `${home}/ws/project-a-quiet-basin`;
    const ctx = { ...rootsForChild({ id: 'project-a-quiet-basin', workdir: wt, child: { kind: 'child', runId: 7 } }, home)!, cwd: wt };
    const p = `${wt}/vendor${rel}`;   // inside the worktree: outside it the roots forbid every write anyway
    expect(approvalClass('Edit', { file_path: p, old_string: 'a', new_string: 'b' }, ctx)).toBe('forbidden');
    expect(approvalClass('Bash', { command: `cp /tmp/x ${p}` }, ctx)).toBe('forbidden');
    expect(approvalClass('Bash', { command: `rm -rf ${wt}/vendor/.local/libexec/ccrc/core` }, ctx)).toBe('forbidden');
  });
});
