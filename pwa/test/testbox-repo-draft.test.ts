// D-9009 (plan docs/superpowers/plans/2026-11-24-testbox-widen.md): the connect card's repository row from what the operator
// typed, decided in `src/fleet/testboxAdminWords.ts` (L1), not in the card. One draft makes one row of several packages, in
// install order, each with the command heads the box runs there; spec 2026-10-28 §2.5's heads are the default. Every row this
// builds must parse as the box's own reader parses it (`shared/testbox.ts#parseRepoRow`).
import { describe, expect, it } from 'vitest';
import { isVitestProgram, parseRepoRow } from '../../shared/testbox';
import {
  TESTBOX_CONNECT_TEXT as T, TESTBOX_DEFAULT_HEADS, TESTBOX_DEFAULT_RUNNER, blankRepoDraft, repoDraftProblems, repoRowOf,
  type TestboxRepoDraft,
} from '../src/fleet/testboxAdminWords';

const ROOT = '/var/lib/ccrc-testbox';
const draft = (over: Partial<TestboxRepoDraft> = {}): TestboxRepoDraft =>
  ({ ...blankRepoDraft(), name: 'project-a', fetchUrl: 'https://git.invalid/team/project-a', pkg: 'server', ...over });
const pkgs = (row: Record<string, unknown>) => row.packages as { name: string; installInputs: string[]; commands: string[] }[];

describe('the default command heads (spec §2.5)', () => {
  it('are the four heads §2.5 names, the runner first, because parity runs the first package\'s first head', () => {
    expect(TESTBOX_DEFAULT_HEADS).toEqual(['./node_modules/.bin/vitest', './node_modules/.bin/tsc', 'npm test', 'npm run test:browser']);
    expect(TESTBOX_DEFAULT_HEADS[0]).toBe(TESTBOX_DEFAULT_RUNNER);
    expect(new Set(TESTBOX_DEFAULT_HEADS).size).toBe(TESTBOX_DEFAULT_HEADS.length);
  });

  it('a new draft starts with every one of them, and its row gives them all to its package', () => {
    const row = repoRowOf(draft(), ROOT);
    expect(pkgs(row)).toEqual([{ name: 'server', installInputs: ['server/package.json', 'server/package-lock.json'], commands: [...TESTBOX_DEFAULT_HEADS] }]);
    expect(parseRepoRow(JSON.stringify(row)).ok).toBe(true);
  });
});

describe('repoRowOf (D-9009)', () => {
  it('several packages, in the order typed, are several packages of one row, each with its own install pair', () => {
    const row = repoRowOf(draft({ pkg: 'server agent ui pwa' }), `${ROOT}/`);
    expect(row.name).toBe('project-a');
    expect(row.mirrorPath).toBe(`${ROOT}/mirrors/project-a.git`);
    expect(pkgs(row).map((p) => p.name)).toEqual(['server', 'agent', 'ui', 'pwa']);
    for (const p of pkgs(row)) {
      expect(p.installInputs).toEqual([`${p.name}/package.json`, `${p.name}/package-lock.json`]);
      expect(p.commands).toEqual([...TESTBOX_DEFAULT_HEADS]);
    }
    expect(row.buildOutputs).toEqual([]);
    expect(row.systemTools).toEqual([]);
    const parsed = parseRepoRow(JSON.stringify(row));
    expect(parsed.ok).toBe(true);
  });

  it('commands are separated by commas, each a head of words, and the first typed stays first', () => {
    const row = repoRowOf(draft({ pkg: ' server  pwa ', command: ' ./node_modules/.bin/vitest ,npm run test:browser,, ' }), ROOT);
    expect(pkgs(row).map((p) => p.name)).toEqual(['server', 'pwa']);
    expect(pkgs(row)[0]!.commands).toEqual(['./node_modules/.bin/vitest', 'npm run test:browser']);
    expect(pkgs(row)[1]!.commands).toEqual(['./node_modules/.bin/vitest', 'npm run test:browser']);
  });

  it('a typed install input is added to the listed package its path starts with, after that package\'s own pair', () => {
    const row = repoRowOf(draft({ pkg: 'server pwa', inputs: 'pwa/extra.json' }), ROOT);
    expect(pkgs(row)[0]!.installInputs).toEqual(['server/package.json', 'server/package-lock.json']);
    expect(pkgs(row)[1]!.installInputs).toEqual(['pwa/package.json', 'pwa/package-lock.json', 'pwa/extra.json']);
  });

  it('an input under no listed package is added to the first package\'s pair, never in place of it (review of #3342)', () => {
    // The box builds a package's pristine copy from a tree holding only its install inputs and keys it on them
    // (agent/src/testbox/pristine.ts), so a package whose inputs lack its own package.json and lockfile fails every npm ci.
    const two = repoRowOf(draft({ pkg: 'server pwa', inputs: 'shared/x.json' }), ROOT);
    expect(pkgs(two)[0]!.installInputs).toEqual(['server/package.json', 'server/package-lock.json', 'shared/x.json']);
    expect(pkgs(two)[1]!.installInputs).toEqual(['pwa/package.json', 'pwa/package-lock.json']);
    const one = repoRowOf(draft({ inputs: 'shared/x.json' }), ROOT);
    expect(pkgs(one)[0]!.installInputs).toEqual(['server/package.json', 'server/package-lock.json', 'shared/x.json']);
  });

  it('typing a package\'s own pair again changes nothing: each input is listed once', () => {
    const row = repoRowOf(draft({ inputs: 'server/package.json server/package-lock.json shared/x.json shared/x.json' }), ROOT);
    expect(pkgs(row)[0]!.installInputs).toEqual(['server/package.json', 'server/package-lock.json', 'shared/x.json']);
    expect(parseRepoRow(JSON.stringify(row)).ok).toBe(true);
  });

  it('every package of every row holds its own package.json and package-lock.json first, whatever was typed', () => {
    for (const inputs of ['', 'shared/x.json', 'pwa/extra.json agent/y.json', 'ui/package.json other/z.json']) {
      for (const p of pkgs(repoRowOf(draft({ pkg: 'server agent ui pwa', inputs }), ROOT))) {
        expect(p.installInputs.slice(0, 2), `${inputs} ${p.name}`).toEqual([`${p.name}/package.json`, `${p.name}/package-lock.json`]);
      }
    }
  });
});

describe('repoDraftProblems (D-9009)', () => {
  it('a draft of four packages and the default heads has none', () => {
    expect(repoDraftProblems(draft({ pkg: 'server agent ui pwa' }), ROOT)).toEqual({});
  });

  it('a package name off the name shape is the package field\'s problem', () => {
    expect(repoDraftProblems(draft({ pkg: 'server ../pwa' }), ROOT).pkg).toBe(T.badRepoName);
    expect(repoDraftProblems(draft({ pkg: '   ' }), ROOT).pkg).toBe(T.badRepoName);
  });

  it('a package named twice, or a command given twice, is said on its own field, not as a bad row', () => {
    const p = repoDraftProblems(draft({ pkg: 'server pwa server' }), ROOT);
    expect(p.pkg).toBe(T.badRepoTwice);
    expect(p.row).toBeUndefined();
    const c = repoDraftProblems(draft({ command: 'npm test, npm test' }), ROOT);
    expect(c.command).toBe(T.badRepoTwice);
    expect(c.row).toBeUndefined();
  });

  it('no command at all, or a head with a doubled space, is the command field\'s problem', () => {
    expect(repoDraftProblems(draft({ command: ' , ' }), ROOT).command).toBe(T.badRepoWord);
    expect(repoDraftProblems(draft({ command: 'npm  test' }), ROOT).command).toBe(T.badRepoWord);
  });

  it('the first command must be a vitest runner, because parity runs it and only a vitest head gets the report flags (review of #3342)', () => {
    for (const command of ['./node_modules/.bin/tsc, ./node_modules/.bin/vitest', 'npm test', 'npx vitest', 'npm run test:browser, ./node_modules/.bin/vitest']) {
      expect(repoDraftProblems(draft({ command }), ROOT).command, command).toBe(T.badRepoRunner);
    }
    for (const command of [TESTBOX_DEFAULT_RUNNER, 'node_modules/.bin/vitest, npm test', 'vitest', TESTBOX_DEFAULT_HEADS.join(', ')]) {
      expect(repoDraftProblems(draft({ command }), ROOT).command, command).toBeUndefined();
    }
    expect(repoDraftProblems(draft({ pkg: 'server agent ui pwa', command: './node_modules/.bin/tsc' }), ROOT).command).toBe(T.badRepoRunner);
  });

  it('a vitest program is a word whose last path segment is vitest, as the box decides it for a run\'s first word', () => {
    for (const w of ['./node_modules/.bin/vitest', 'vitest', '/opt/x/vitest', 'node_modules/.bin/vitest/']) expect(isVitestProgram(w), w).toBe(true);
    for (const w of ['npx', './node_modules/.bin/vitest-x', './node_modules/.bin/tsc', 'vitest/run', '']) expect(isVitestProgram(w), w).toBe(false);
  });

  it('a row the box would refuse is the row\'s problem', () => {
    expect(repoDraftProblems(draft({ inputs: '/etc/passwd' }), ROOT).row).toBe(T.badRepoRow);
  });
});
