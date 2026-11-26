/**
 * The quiz row's literal gate (issue #3418's cost; programme overlord, wave 240). Every pattern of the session hook's
 * `qzmatch` holds the literal `quiz`, so the row cannot match a string without it. The forbidden program therefore asks
 * two linear gates before the row's quadratic work: `QZANC`, asked of the command as written BEFORE `norm` is computed
 * (`q`, `u`, `i`, `z` with only the characters `norm` removes between them, `QCH`: the prune row's `PANC` form), and
 * `quiz` itself, asked inside `qzmatch` of each form, the written and the normalised one, separately.
 *
 * What is held here:
 *  - EQUIVALENCE: the gated program answers exactly what the same program with both gates cut out answers (the row as
 *    it stood before the gate), in every mode, over every command of `session-hook-quiz-deny.test.ts`'s lists (copied,
 *    built by the same builders) and spellings where only the normalised form holds the literal.
 *  - THE CLAIM, sampled: the ungated row answers nothing once the literal is respelled out of a refused command.
 *  - COST: on a quote-dense command with no such literal, the gated program costs what the program with the quiz row
 *    deleted costs, at 32 and 64 KB, measured as the prune-deny suite measures (the CPU of the jq child, the faster of
 *    two interleaved runs). Without the gate the row adds about a third (#3418), well past this bound.
 *
 * The jq program runs directly (no hook, no HOME): the shell-side prefilter is not under test here.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { spawnSyncGroup } from './spawnGroup.js';
import { scaled } from './timeScale.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');

/** The hook's jq program, read out of the hook (one single-quoted assignment), never respelled here. */
const hookProgram = (): string => {
  const m = /^APPROVAL_FORBIDDEN_JQ='([^']*)'$/m.exec(fs.readFileSync(HOOK, 'utf8'));
  if (m === null) throw new Error('APPROVAL_FORBIDDEN_JQ is not one single-quoted assignment in the hook');
  return m[1] as string;
};

/** `src` with every `cut` removed; throws unless it occurs exactly `times` times, so a moved gate reds here. */
const cutOut = (src: string, cut: string, times: number): string => {
  const parts = src.split(cut);
  if (parts.length - 1 !== times) throw new Error(`expected ${times} of ${JSON.stringify(cut)}, found ${parts.length - 1}`);
  return parts.join('');
};

const ANCHOR = 'select(test(QZANC)) | ';
const LITERAL = 'select(test("quiz")) |';
const ROW = ' // first(select(test(QZANC)) | (., norm) | qzmatch)';
const gated = hookProgram();
/** The row as it stood before the gate: both gates cut out, nothing else touched. */
const ungated = (): string => cutOut(cutOut(gated, ANCHOR, 2), LITERAL, 1);
/** The program with the quiz row deleted from both modes that ask it: the cost floor. */
const rowless = (): string => cutOut(gated, ROW, 2);

type Mode = 'deny' | 'account' | 'class';
const MODES: readonly Mode[] = ['deny', 'account', 'class'];

/** Runs `prog` over a stream of Bash payloads in `mode`: one JSON-encoded answer per command. */
const answers = (prog: string, mode: Mode, commands: readonly string[]): string[] => {
  const input = commands.map((command) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } })).join('\n');
  const r = spawnSync('jq', ['-c', '--arg', 'q', "'", '--arg', 'mode', mode, prog],
    { input, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, LC_ALL: 'C' }, timeout: scaled(120_000) });
  expect(r.status, r.stderr).toBe(0);
  const lines = r.stdout.replace(/\n$/, '').split('\n');
  expect(lines, 'one answer per command').toHaveLength(commands.length);
  return lines.map((l) => JSON.parse(l) as string);
};

// The lists of session-hook-quiz-deny.test.ts, copied with their builders (a test file's constants are not importable
// without registering its cases). They are the floor of what the row refuses and lets through.
const VERBS = ['record', 'confirm', 'status'] as const;
const PROGRAMS: ReadonlyArray<(v: string) => string> = [
  (v) => `ccrc-api quiz ${v} --id 12`,
  (v) => `~/.local/bin/ccrc-api quiz ${v} --id 12`,
  (v) => `/opt/tools/.local/bin/ccrc-api quiz ${v} --id 12`,
  (v) => `./ccrc-api quiz ${v}`,
  (v) => `"ccrc-api" quiz ${v}`,
  (v) => `'ccrc-api' quiz ${v}`,
  (v) => `API=x; $API quiz ${v}`,
  (v) => `\${CLIENT} quiz ${v}`,
  (v) => `"$API" quiz ${v}`,
  (v) => `ccrc-api --json quiz --x ${v}`,
  (v) => `cd work && ccrc-api quiz ${v}`,
];
const SHELL_FORMS: readonly string[] = [
  'ccrc quiz-record --report r.json --sha abc --confirm',
  'env -u CLAUDECODE -u TMUX_PANE ccrc quiz-record --report r.json --sha abc --confirm',
  '~/.local/bin/ccrc quiz-record --report r.json',
  '"ccrc" quiz-record --report r.json',
  'C=ccrc; $C quiz-record --report r.json',
  'ccrc-quiz-record --report r.json --confirm',
  '\'ccrc-quiz-record\' --confirm',
  '~/.local/bin/ccrc-quiz-record --report r.json',
  '"$HOME/.local/bin/ccrc-quiz-record" --confirm',
  './ccd/ccrc-quiz-record --report r.json',
  'env -u CLAUDECODE -u TMUX_PANE ./ccd/ccrc-quiz-record --confirm',
  'bash ccd/ccrc-quiz-record --confirm',
  'cd work && ccd/ccrc-quiz-record --confirm',
  'Q=ccrc-quiz-record; $Q --confirm',
];
const SPELLINGS: readonly string[] = [
  'ccrc-api quiz\trecord --id 1',
  'ccrc-api\tquiz confirm --id 1',
  'ccrc-api quiz \\\nstatus --json -',
  'V=record; ccrc-api quiz $V --id 1',
  'ccrc-api quiz "$V" --id 1',
  'ccrc-api quiz ${ACT} --id 1',
];
const TEXT_ONLY: readonly string[] = ['git commit -m "note ccrc-api quiz record"'];
const OPEN: readonly string[] = [
  'ccrc-api quiz live', '~/.local/bin/ccrc-api quiz live --id 12', 'ccrc-api mail send --json -',
  'grep -n quiz somefile', 'cat quiz-notes.md', 'ccrc-api quizzes status', 'echo record confirm status',
  'cat ccd/ccrc-quiz-record', 'git add ccd/ccrc-quiz-record server/test/ccrc-quiz-record.test.ts',
  './node_modules/.bin/vitest run test/ccrc-quiz-record.test.ts', 'git diff -- ccd/ccrc-quiz-record',
];
const QUIZ_DENY_LISTS: readonly string[] = [
  ...VERBS.flatMap((v) => PROGRAMS.map((b) => b(v))), ...SHELL_FORMS, ...SPELLINGS, ...TEXT_ONLY, ...OPEN,
];

/** Spellings whose literal appears only once `norm` has removed quotes, backslashes and `$`: each is refused. */
const NORM_ONLY: readonly string[] = [
  'ccrc-api qu\'i\'z record --id 1',
  'ccrc-api "qu"iz confirm',
  'ccrc-api qu\\iz status',
  'ccrc-api q\\\nuiz record',
  'ccrc-api $\'qu\'iz status',
  '"$API" qu\'\'iz record',
  'ccrc q\'\'uiz-record --report r.json',
  'ccrc-q"uiz"-record --confirm',
];
/** Near misses and other rows: each answers the same with and without the gate. */
const OTHERS: readonly string[] = [
  'ccrc-api QUIZ record', 'ccrc-api qu iz record', 'ccrc-api quix record', 'echo q u i z', 'ccrc-api qu\'i\'z live',
  'ccd ws-rm x; ccrc-api quiz record', 'git worktree prune; ccrc-api quiz record', 'printenv; ccrc-api qu"i"z status',
  `echo ${'a "b c" \'d\' \\e '.repeat(400)}; ccrc-api quiz record`,
  `echo ${'a "b c" \'d\' \\e '.repeat(400)}; ccrc-api q'ui'z confirm`,
  '', 'ls -la',
];

describe('the quiz row\'s literal gate changes no answer', () => {
  it('the gate is where the row is asked: the anchor before norm in both modes, the literal inside the row', () => {
    expect(ungated()).not.toContain('QZANC)');
    expect(ungated()).not.toBe(gated);
    expect(rowless()).not.toContain('qzmatch)');
  });

  it('the copied lists still say what the quiz deny suite says: refusals refused, the open list open (deny mode)', () => {
    const out = answers(gated, 'deny', QUIZ_DENY_LISTS);
    QUIZ_DENY_LISTS.forEach((c, i) => {
      if (OPEN.includes(c)) expect(out[i], c).toBe('');
      else expect(out[i], c).toMatch(/^quiz\t/);
    });
  });

  it('a literal only the normalised form holds is still refused, in deny and account modes', () => {
    for (const mode of ['deny', 'account'] as const) {
      const out = answers(gated, mode, NORM_ONLY);
      NORM_ONLY.forEach((c, i) => expect(out[i], `${mode}: ${c}`).toMatch(/^quiz\t/));
    }
  });

  it.each(MODES)('%s mode: the gated program answers every command exactly as the ungated one', (mode) => {
    const all = [...QUIZ_DENY_LISTS, ...NORM_ONLY, ...OTHERS];
    const before = answers(ungated(), mode, all);
    const after = answers(gated, mode, all);
    all.forEach((c, i) => expect(after[i], `${mode}: ${JSON.stringify(c.slice(0, 80))}`).toBe(before[i]));
  });

  it('the claim, sampled: with the literal respelled out of each refused command, the ungated row refuses nothing', () => {
    const refused = QUIZ_DENY_LISTS.filter((c) => !OPEN.includes(c));
    const respelled = refused.map((c) => c.split('quiz').join('qu1z'));
    for (const c of respelled) expect(c).not.toContain('quiz');
    for (const mode of ['deny', 'account'] as const) {
      const out = answers(ungated(), mode, respelled);
      respelled.forEach((c, i) => expect(out[i], `${mode}: ${c}`).not.toMatch(/^quiz\t/));
    }
  });
});

// The prune-deny suite's cost measure (D-8334, D-8354), restated for this suite: CPU, not wall time, of one jq run that
// reads its input from a regular file.
type CpuRun = { status: number | null; stdout: string; stderr: string; cpuMs: number };
const childCpu = (argv: readonly string[], input: string, timeoutMs = scaled(120_000)): CpuRun => {
  const dir = mkTmp('ccrc-quizgate-cpu-');
  const file = path.join(dir, 'stdin');
  fs.writeFileSync(file, input);
  const fd = fs.openSync(file, 'r');
  let r: ReturnType<typeof spawnSyncGroup>;
  try {
    r = spawnSyncGroup('bash', ['-c', '"$@"; s=$?; times >&2; exit $s', 'bash', ...argv],
      { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 26, timeout: timeoutMs, env: { ...process.env, LC_ALL: 'C' } });
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const lines = (r.stderr ?? '').replace(/\n$/, '').split('\n');
  const m = /^(\d+)m(\d+(?:\.\d+)?)s (\d+)m(\d+(?:\.\d+)?)s$/.exec(lines.at(-1) ?? '');
  expect(m, `bash's times line, after ${JSON.stringify(r.stderr)}${r.error === undefined ? '' : `: ${String(r.error)}`}`).not.toBeNull();
  const [, um, us, sm, ss] = m as RegExpExecArray;
  const cpuMs = Math.round((Number(um) * 60 + Number(us) + Number(sm) * 60 + Number(ss)) * 1000);
  return { status: r.status, stdout: r.stdout ?? '', stderr: lines.slice(0, -2).join('\n'), cpuMs };
};

/**
 * The bound: the gated program within 15% (or 25 ms) of the program with the row deleted. Measured on the fleet box at
 * load 16 (deny mode, quote-dense, faster of interleaved runs): gated against rowless 0.98 to 1.08; the ungated row
 * against rowless 1.27 to 1.40 at 32 KB and 1.48 to 1.75 at 64 KB.
 */
const BOUND = 1.15;

describe('the quiz row costs nothing on a quote-dense command that holds no literal', () => {
  const unit = 'a "b c" \'d\' \\e ';
  const timed = (prog: string, kb: number): number => {
    const dense = unit.repeat(Math.floor((kb * 1024) / unit.length));
    const command = `git worktree list --porcelain; echo prune ${dense}`;
    expect(command).not.toMatch(/q[^u]*u[^i]*i[^z]*z/);
    const r = childCpu(['jq', '-r', '--arg', 'q', "'", '--arg', 'mode', 'deny', prog],
      JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('');
    return r.cpuMs;
  };
  for (const kb of [32, 64]) {
    it(`deny mode at ${kb} KB: the gated program within ${BOUND}x of the program with the row deleted`, () => {
      const floor = rowless();
      const pairs = [0, 1].map(() => [timed(gated, kb), timed(floor, kb)]);
      const gatedMs = Math.min(...pairs.map((p) => p[0] as number));
      const floorMs = Math.min(...pairs.map((p) => p[1] as number));
      const measured = `quotes/deny ${kb} KB: gated ${gatedMs} cpu ms, row deleted ${floorMs} cpu ms, ratio ${(gatedMs / floorMs).toFixed(3)}x, bound ${BOUND}x`;
      console.info(measured);
      expect(gatedMs, measured).toBeLessThanOrEqual(Math.max(BOUND * floorMs, floorMs + 25));
    }, scaled(600_000));
  }
});
