// The approval classifier (D-5299, spec 2026-10-17 §6.5): default escalate. Pure: no I/O, no clock.
//
// The corpus (`fixtures/approvals/guard-corpus.json`) is the one list of neutral commands both copies of the
// `forbidden` match answer to: this suite holds the TypeScript classifier to it, and the hook's static bash copy
// (plan Task 14) iterates the same file. Every row's roots are the child's OWN, derived from one registry row by
// `rootsForChild`, never written into the row; a row's `ctx` carries the request's `cwd`, and a hostile root only
// where the row is about the never-a-root filter.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVAL_CLASS_MAP, FORBIDDEN_PATTERNS, approvalClass, isApprovalClass, rootsForChild, type ApprovalClass, type ApprovalCtx,
} from '../src/coord/approvalguard.js';
import {
  BASH_DOCUMENTED_VARIABLES, BASH_STARTUP_VARIABLES, BASH_VARIABLES, ENV_VARIABLES, POSIX_SPECIAL_PARAMETERS,
  ZSH_DOCUMENTED_VARIABLES, ZSH_STARTUP_VARIABLES, ZSH_VARIABLES, isUserVariable,
} from '../src/coord/bash-variables.js';

const here = path.dirname(fileURLToPath(import.meta.url));

interface CorpusRow {
  tool: string; input: Record<string, unknown>; class: ApprovalClass; why: string;
  ctx: { cwd: string | null; scratch?: string | null; tmpRoot?: string | null };
}
const CORPUS: CorpusRow[] = JSON.parse(readFileSync(path.join(here, 'fixtures/approvals/guard-corpus.json'), 'utf8'));

const HOME = '/rig/home';
const WT = `${HOME}/ws/project-a-quiet-basin`;
/** The child's registry row, in the shape `rootsForChild` reads: a `.child` marker naming its run. */
const CHILD_ROW = { id: 'project-a-quiet-basin', workdir: WT, child: { kind: 'child', runId: 7 } } as const;

function ctxFor(row: CorpusRow['ctx']): ApprovalCtx {
  const roots = rootsForChild(CHILD_ROW, HOME);
  if (roots === null) throw new Error('the fixture child row has no roots');
  return { ...roots, ...row };
}
const bash = (command: string, cwd: string | null = WT): ApprovalClass => approvalClass('Bash', { command }, ctxFor({ cwd }));

describe('the class map (D-5299)', () => {
  it('has exactly the three classes, each described', () => {
    expect(Object.keys(APPROVAL_CLASS_MAP).sort()).toEqual(['escalate', 'forbidden', 'ordinary']);
    for (const v of Object.values(APPROVAL_CLASS_MAP)) expect(v.length).toBeGreaterThan(10);
    expect(isApprovalClass('ordinary')).toBe(true);
    expect(isApprovalClass('allow')).toBe(false);
  });
});

describe('rootsForChild: the child\'s own three roots, from its registry row', () => {
  it('the worktree, the own ~/.cc-tmp leaf, and no scratch root until a version records its shape', () => {
    expect(rootsForChild(CHILD_ROW, HOME)).toEqual({
      worktree: WT, tmpRoot: `${HOME}/.cc-tmp/project-a-quiet-basin`, scratch: null, home: HOME,
    });
  });

  it('a row that is not a child, or whose marker is unreadable, has no roots', () => {
    expect(rootsForChild({ ...CHILD_ROW, child: { kind: 'none' } }, HOME)).toBeNull();
    expect(rootsForChild({ ...CHILD_ROW, child: { kind: 'unreadable' } }, HOME)).toBeNull();
  });

  it('an id that is not a temp-root id, or a home that is not absolute, has no roots', () => {
    expect(rootsForChild({ ...CHILD_ROW, id: '../project-a-still-cove' }, HOME)).toBeNull();
    expect(rootsForChild(CHILD_ROW, 'rig/home')).toBeNull();
  });

  it('a workdir that is a never-a-root path is no worktree root', () => {
    for (const workdir of ['/', '/tmp', '/private/tmp', HOME, `${HOME}/.cc-tmp`, 'relative/wt']) {
      expect(rootsForChild({ ...CHILD_ROW, workdir }, HOME)?.worktree ?? null, workdir).toBeNull();
    }
  });
});

describe('the corpus (spec §6.5, every table line and named shape)', () => {
  it('carries all three classes and every row names why', () => {
    const classes = new Set(CORPUS.map((r) => r.class));
    expect([...classes].sort()).toEqual(['escalate', 'forbidden', 'ordinary']);
    for (const r of CORPUS) expect(r.why.length, JSON.stringify(r)).toBeGreaterThan(2);
  });

  for (const [i, r] of CORPUS.entries()) {
    it(`#${i} ${r.class}: ${r.why}`, () => {
      expect(approvalClass(r.tool, r.input, ctxFor(r.ctx)), `${r.tool} ${JSON.stringify(r.input)} cwd=${r.ctx.cwd}`).toBe(r.class);
    });
  }
});

describe('the step-1 cases', () => {
  const ordinaryLines = Array.from({ length: 80 }, (_, i) => `mkdir -p build/step-${i} && touch build/step-${i}/stamp`);

  it('a 2,000-character script with one forbidden line is forbidden', () => {
    const lines = [...ordinaryLines]; lines.splice(40, 0, 'ccd ws-rm project-a-still-cove');
    const script = lines.join('\n');
    expect(script.length).toBeGreaterThan(2000);
    expect(bash(script)).toBe('forbidden');
  });

  it('with one unknown command among recognised ones it is escalate', () => {
    const lines = [...ordinaryLines]; lines.splice(40, 0, 'make all');
    const script = lines.join('\n');
    expect(script.length).toBeGreaterThan(2000);
    expect(bash(script)).toBe('escalate');
    expect(bash(ordinaryLines.join('\n'))).toBe('ordinary');
  });

  it('rm -rf "$X" with X unassigned is escalate; with X=$(mktemp -d) earlier it is ordinary', () => {
    expect(bash('rm -rf "$X"')).toBe('escalate');
    expect(bash('X=$(mktemp -d); rm -rf "$X"')).toBe('ordinary');
  });

  it('rm -rf "$X/" with X assigned to an empty string is escalate', () => {
    expect(bash('X=""; rm -rf "$X/"')).toBe('escalate');
  });

  it('rm -rf . at the worktree root is escalate (the root itself)', () => {
    expect(bash('rm -rf .')).toBe('escalate');
  });

  it('ccrc-api approvals rule 1 allow is forbidden', () => {
    expect(bash('ccrc-api approvals rule 1 allow')).toBe('forbidden');
  });

  it('the claimant mail\'s own rule block (a quoted heredoc, then jq into the client) is forbidden to a child (D-5489)', () => {
    expect(bash('IFS= read -r reason <<\'REASON\'\nfine\nREASON\n' +
      'jq -nc --arg id "$id" --arg uuid "$uuid" --arg reason "$reason" \'{fromId:$id,fromUuid:$uuid,verdict:"allow",reason:$reason}\' |\n' +
      '  "$API" approvals rule 1 --json -\n')).toBe('forbidden');
  });
});

describe('fail toward the operator', () => {
  it('an unclosed quote, a non-string command and an unknown tool escalate', () => {
    expect(bash('rm -rf "build')).toBe('escalate');
    expect(approvalClass('Bash', { command: 42 }, ctxFor({ cwd: WT }))).toBe('escalate');
    expect(approvalClass('Bash', {}, ctxFor({ cwd: WT }))).toBe('escalate');
    expect(bash('')).toBe('escalate');
  });

  it('a symlink is outside the guard: resolution is lexical (spec §6.1\'s accepted limit)', () => {
    // `build` may link anywhere; the classifier cannot see the fleet filesystem and says so by being lexical.
    expect(bash('rm -rf build/*')).toBe('ordinary');
  });
});

// D-5299: the classifier runs synchronously inside a server route, and a child chooses the text. Nothing past the
// stored cap reaches a regex, and every pattern below it is linear: a cap-sized adversarial line stays cheap.
describe('bounded cost (D-5299)', () => {
  const CAP = 16 * 1024;
  const fill = (unit: string, tail = ''): string => unit.repeat(Math.floor((CAP - tail.length) / unit.length)) + tail;

  it('a request over the stored cap is escalate before any match, even one naming a forbidden verb', () => {
    expect(bash(`ccd ws-rm x; ${'#'.repeat(CAP)}`)).toBe('escalate');
    expect(bash(`ls ${'a'.repeat(CAP)}`)).toBe('escalate');
    expect(approvalClass('mcp__x__y', { q: 'ccd ws-rm x', pad: 'a'.repeat(CAP) }, ctxFor({ cwd: WT }))).toBe('escalate');
    expect(bash(`ccd ws-rm x; ${'#'.repeat(CAP - 32)}`)).toBe('forbidden');
  });

  for (const [name, text] of [
    ['repeated redirects', fill(' x>')],
    ['repeated cat words', fill('cat ')],
    ['repeated rm words', fill('rm ')],
    ['repeated kill words', fill('kill ')],
    ['repeated ccd ws-gc', fill('ccd ws-gc a ')],
    ['repeated ccd flags', fill('ccd -a ')],
    ['repeated sed -i flags', fill('sed -a ')],
    ['repeated cd moves', fill('cd ./a; ')],
    ['repeated assignments in one and-or list', fill('X=./a&&')],
    ['repeated distinct assignments', Array.from({ length: 2000 }, (_, i) => `V${i}=./a`).join('||').slice(0, CAP)],
    ['repeated uses', `X=./a; ${fill('ls "$X"; ')}`.slice(0, CAP)],
    ['nested subshells', `${'( '.repeat(4000)}ls${' )'.repeat(4000)}`],
  ] as const) {
    it(`a cap-sized line of ${name} is classed in under 250 ms`, () => {
      const t0 = performance.now();
      approvalClass('Bash', { command: text }, ctxFor({ cwd: WT }));
      expect(performance.now() - t0).toBeLessThan(250);
    });
  }

  it('every forbidden pattern is linear: a 256 KB adversarial line is matched in under 250 ms', () => {
    const big = (unit: string): string => unit.repeat(Math.floor((256 * 1024) / unit.length));
    const units = [' x>', 'cat ', 'rm ', 'kill ', 'systemctl ', 'ccd ws-gc a ', 'ccd -a ', 'sed -a ', 'perl -a ', 'tee ',
      '/api/sessions/a', '/api/sessions/"a"/workflows/b', '/api/sessions/a/workflows/b/contro'];
    for (const p of FORBIDDEN_PATTERNS) {
      for (const u of units) {
        const t0 = performance.now();
        p.test(big(u));
        expect(performance.now() - t0, `${p.why} on ${JSON.stringify(u)}`).toBeLessThan(250);
      }
    }
  });
});

// D-5360: a user variable is a name bash gives no meaning to. The list is generated from bash, not written from memory:
// every bash on PATH is run as `env -i bash --norc --noprofile -c 'compgen -v'`, and a name it prints that the
// committed list lacks fails here, so a newer bash's variable cannot slip past.
describe("bash's own variables (D-5360)", () => {
  const bashes = [...new Set((process.env.PATH ?? '').split(':').filter(Boolean)
    .map((d) => path.join(d, 'bash')).filter((b) => existsSync(b)).map((b) => realpathSync(b)))];
  const compgen = (bash: string): { version: string; names: string[] } => ({
    version: execFileSync(bash, ['--norc', '--noprofile', '-c', 'printf %s "$BASH_VERSION"'], { env: {}, encoding: 'utf8' }),
    names: execFileSync(bash, ['--norc', '--noprofile', '-c', 'compgen -v'], { env: {}, encoding: 'utf8' }).split('\n').filter(Boolean),
  });

  it('every name bash itself prints at startup is on the committed list, for every bash on PATH', () => {
    for (const bash of bashes) {
      const { version, names } = compgen(bash);
      expect(names.filter((n) => !BASH_VARIABLES.has(n)), `${bash} ${version}`).toEqual([]);
      // The committed startup list is bash 5.3's output exactly: a 5.3 that prints a different set is drift too.
      if (version.startsWith('5.3.')) expect([...names].sort(), `${bash} ${version}`).toEqual([...BASH_STARTUP_VARIABLES].sort());
    }
  });

  it('no bash on PATH is a test that silently checks nothing: a bash 4 or newer is found where bash is installed', () => {
    const versions = bashes.map((b) => compgen(b).version);
    if (bashes.length > 0) expect(versions.some((v) => Number(v.split('.')[0]) >= 4), versions.join(', ')).toBe(true);
  });

  it('every startup, documented and environment name is refused as a user variable, and so is every family', () => {
    for (const n of [...BASH_STARTUP_VARIABLES, ...BASH_DOCUMENTED_VARIABLES, ...ENV_VARIABLES]) expect(isUserVariable(n), n).toBe(false);
    for (const n of ['FUNCNAME', 'DIRSTACK', 'GROUPS', 'BASH_FOO', 'LC_PAPER', 'GIT_EXEC_PATH', 'LD_PRELOAD', 'XDG_CONFIG_HOME', 'HISTX', 'COMPX', '_x']) {
      expect(isUserVariable(n), n).toBe(false);
    }
    for (const p of POSIX_SPECIAL_PARAMETERS) expect(isUserVariable(p), p).toBe(false);
  });

  it("the measured prompts' names are user variables", () => {
    for (const n of ['X', 'T', 'WT', 'TMPD', 'OUT', 'dir', 'scratch_dir']) expect(isUserVariable(n), n).toBe(true);
  });
});

// D-5360 round 7, defence in depth: the grammar is bash's, but a zsh child would give its own parameters a meaning
// (`path=./bin`, `cdpath=/`). The zsh list is generated from zsh the same way the bash list is.
describe("zsh's own parameters (D-5360 round 7)", () => {
  const zshes = [...new Set((process.env.PATH ?? '').split(':').filter(Boolean)
    .map((d) => path.join(d, 'zsh')).filter((z) => existsSync(z)).map((z) => realpathSync(z)))];
  const SPECIAL = new Set([...POSIX_SPECIAL_PARAMETERS, '_']);

  it('every name zsh itself prints at startup is on the committed list, for every zsh on PATH', () => {
    for (const zsh of zshes) {
      const names = execFileSync(zsh, ['-f', '-c', 'print -l ${(k)parameters}'], { env: {}, encoding: 'utf8' })
        .split('\n').filter((n) => n !== '' && !SPECIAL.has(n));
      expect(names.filter((n) => !ZSH_VARIABLES.has(n)), zsh).toEqual([]);
    }
  });

  it('every zsh startup and documented name, and the ZSH_ family, is refused as a user variable', () => {
    for (const n of [...ZSH_STARTUP_VARIABLES, ...ZSH_DOCUMENTED_VARIABLES, 'ZSH_FOO', 'ZLE_RPROMPT_INDENT']) expect(isUserVariable(n), n).toBe(false);
  });
});

// D-5696 (spec §7.6): rolling, installing and selecting a Claude Code build are the operator's acts or ccrc's own,
// never a session's. `ccd roll` and the operator's `ccd claude …` verbs are forbidden (under default-escalate a child's
// `ccd roll` is a deny, not an approvable prompt), and so is a write into the build directory or onto the launcher.
// Account switching is not touched (operator ruling 2026-10-19): `ccd swap` stays exactly what it was.
describe('who may roll, install or select a build (D-5696)', () => {
  it('a child\'s `ccd roll <id> --to <build> --expect <t>` is forbidden, in every spelling the verb list reaches', () => {
    for (const c of ['ccd roll project-a-calm-mesa --to 2.1.302 --expect t', '~/.local/bin/ccd roll project-a-calm-mesa', 'ccd --json roll x']) {
      expect(bash(c), c).toBe('forbidden');
    }
  });
  it('a child\'s `ccd ws-orphan --expect <t> --tree-hex <h>` is forbidden, in every spelling the verb list reaches', () => {
    for (const c of ['ccd ws-orphan --expect t --tree-hex 2f', '~/.local/bin/ccd ws-orphan --expect t', 'cd x && ccd ws-orphan --rescue']) {
      expect(bash(c), c).toBe('forbidden');
    }
  });
  it('a child\'s `ccd claude roll-live on` (an operator switch verb) is forbidden', () => {
    for (const c of ['ccd claude roll-live on', 'ccd claude self-update keep', 'cd x && ccd claude mode off']) expect(bash(c), c).toBe('forbidden');
  });
  it('a write into ~/.local/share/claude/versions/ is forbidden, by Bash and by an edit tool', () => {
    for (const c of [
      'cp /tmp/x ~/.local/share/claude/versions/2.1.302', 'mv build/claude "$HOME/.local/share/claude/versions/2.1.302"',
      'ln -sf /tmp/x /rig/home/.local/share/claude/versions/2.1.302', 'echo x > ~/.local/share/claude/versions/2.1.302',
      'rm -f ~/.local/share/claude/versions/2.1.296', 'truncate -s 0 ~/.local/share/claude/versions/2.1.302',
    ]) expect(bash(c), c).toBe('forbidden');
    expect(approvalClass('Write', { file_path: `${HOME}/.local/share/claude/versions/2.1.302`, content: 'x' }, ctxFor({ cwd: WT }))).toBe('forbidden');
    expect(approvalClass('Edit', { file_path: `${HOME}/.local/share/claude/versions`, old_string: 'a', new_string: 'b' }, ctxFor({ cwd: WT }))).toBe('forbidden');
  });
  it('reading the build directory is not newly forbidden (the rule is about writes)', () => {
    expect(bash('ls ~/.local/share/claude/versions')).not.toBe('forbidden');
    expect(bash('ls ~/.local/share/claude/versions > build/list.txt')).not.toBe('forbidden');
  });
  it('a write onto the launcher is forbidden; a write to ~/.local/bin/ccd or a generated wrapper is not newly forbidden', () => {
    for (const c of ['cp /tmp/x ~/.local/bin/claude', 'ln -sf /tmp/x "$HOME/.local/bin/claude"', 'echo x > /rig/home/.local/bin/claude']) {
      expect(bash(c), c).toBe('forbidden');
    }
    expect(approvalClass('Write', { file_path: `${HOME}/.local/bin/claude`, content: 'x' }, ctxFor({ cwd: WT }))).toBe('forbidden');
    for (const c of ['cp /tmp/x ~/.local/bin/ccd', 'cp /tmp/x ~/.local/bin/claude-a', 'cp /tmp/x ~/.local/bin/claude.bak']) {
      expect(bash(c), c).not.toBe('forbidden');
    }
    expect(approvalClass('Write', { file_path: `${HOME}/.local/bin/ccd`, content: 'x' }, ctxFor({ cwd: WT }))).not.toBe('forbidden');
  });
  it('a sibling of the build directory (versions-old) is not newly forbidden: the directory name ends where it ends', () => {
    expect(bash('cp /tmp/x ~/.local/share/claude/versions-old/2.1.302')).not.toBe('forbidden');
    expect(bash('cp /tmp/x ~/.local/share/claude/versions.bak')).not.toBe('forbidden');
    expect(approvalClass('Write', { file_path: `${HOME}/.local/share/claude/versions-old/x`, content: 'x' }, ctxFor({ cwd: WT }))).not.toBe('forbidden');
  });
  it('~/.ccrc/claude-intent and $REG/claude-roll-live writes are already forbidden by the registry-path pattern', () => {
    for (const c of ['echo x > ~/.ccrc/claude-intent', 'touch ~/.cc-sessions/claude-roll-live']) {
      expect(bash(c), c).toBe('forbidden');
      expect(FORBIDDEN_PATTERNS.filter((p) => p.test(c)).map((p) => p.why), c).toContain('a registry path');
    }
  });
  it('`ccd swap` and the account verbs are unchanged by this rule (the 2026-10-19 ruling)', () => {
    for (const c of ['ccd swap project-a-calm-mesa claude-a', 'ccd swap-self claude-a']) {
      expect(FORBIDDEN_PATTERNS.filter((p) => p.test(c)).map((p) => p.why), c).toEqual([]);
    }
  });
});

// D-5936 (spec 2026-10-20 §4.5): the workflow control verb is the operator's. The classifier forbids any Bash or MCP
// request naming its path, in every spelling a shell builds it in; the auth gate is the wall for any other tool.
describe('the workflow control verb is operator-only (D-5936)', () => {
  it('a `curl` naming the path is `forbidden`', () => {
    expect(bash('curl -sS -X POST "$API_URL"/api/sessions/project-a/workflows/wf_fixture01/control')).toBe('forbidden');
    expect(FORBIDDEN_PATTERNS.filter((p) => p.test('curl -X POST /api/sessions/project-a/workflows/wf_fixture01/control')).map((p) => p.why))
      .toEqual(['a workflow control']);
  });
  it('a path with a variable for the id is `forbidden`', () => {
    for (const c of [
      'curl -X POST "$API_URL/api/sessions/$ID/workflows/wf_fixture01/control"',
      'curl -X POST "$API_URL/api/sessions/${ID}/workflows/${RUN}/control" -d \'{"act":"stop-run"}\'',
    ]) expect(bash(c), c).toBe('forbidden');
  });
  it('a quote-split path (`"$API/api/sessions/$ID/workflows/$RUN"/control`) is `forbidden`', () => {
    for (const c of [
      'curl -X POST "$API/api/sessions/$ID/workflows/$RUN"/control',
      'curl -X POST "$API/api/sessions/"$ID"/workflows/"$RUN"/control"',
      "curl -X POST '/api/sessions/'project-a'/workflows/'wf_fixture01'/control'",
    ]) expect(bash(c), c).toBe('forbidden');
  });
  it('an MCP call naming the path in a string leaf is `forbidden`', () => {
    expect(approvalClass('mcp__x__fetch', { url: 'http://h/api/sessions/project-a/workflows/wf_fixture01/control', method: 'POST' },
      ctxFor({ cwd: WT }))).toBe('forbidden');
  });
  it('a read of `shared/workflows.ts` is unchanged, and so is the read-only workflows path', () => {
    for (const c of ['cat shared/workflows.ts', 'grep -n control shared/workflows.ts', 'curl -sS "$API/api/sessions/project-a/workflows"',
      'curl -sS "$API/api/sessions/project-a/workflows/wf_fixture01/controls"']) {
      expect(FORBIDDEN_PATTERNS.filter((p) => p.test(c)).map((p) => p.why), c).toEqual([]);
    }
    expect(approvalClass('Read', { file_path: `${WT}/shared/workflows.ts` }, ctxFor({ cwd: WT }))).not.toBe('forbidden');
  });
});
