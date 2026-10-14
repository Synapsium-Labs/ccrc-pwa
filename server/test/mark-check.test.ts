// `node shared/mark.mjs --check <file>` — the stamp gate as a command.
//
// Plans name it as the gate for a re-stamped `ccd/ccd`. Before it existed, the
// module had no command line at all, so `node shared/mark.mjs --check <file>`
// loaded the module and exited 0 for ANY file: a gate that could not fail. The
// contract pinned here: exit 0 ONLY when `verifyMarker` answers
// `ccrc-unmodified`; an edited file, a foreign (unmarked) one and a file that
// cannot be read — a missing one included — all exit non-zero; and importing
// the module (including the `node -e … <this file's path> <file>` shape
// `ccrc restamp` uses) never runs the command.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { markGenerated } from '../../shared/mark.mjs';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MARK = path.resolve(here, '..', '..', 'shared', 'mark.mjs');
const dir = mkTmp('mark-check-');

const BODY = '#!/usr/bin/env bash\necho hello\n';
const fixture = (name: string, text: string): string => {
  const p = path.join(dir, name);
  writeFileSync(p, text);
  return p;
};
const STAMPED = fixture('stamped', markGenerated(BODY));
const EDITED = fixture('edited', `${markGenerated(BODY)}echo hand-edit\n`);
const FOREIGN = fixture('foreign', BODY);
const MISSING = path.join(dir, 'missing');
const A_DIR = path.join(dir, 'a-directory');
mkdirSync(A_DIR);

const check = (...args: string[]) => {
  const r = spawnSync(process.execPath, [MARK, ...args], { encoding: 'utf8', cwd: dir });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

describe('node shared/mark.mjs --check <file>', () => {
  it('exits 0 on a ccrc-unmodified file, and says so', () => {
    const r = check('--check', STAMPED);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe(`${STAMPED}: ccrc-unmodified\n`);
  });

  it('exits non-zero on an EDITED file — the stamp no longer matches its body', () => {
    const r = check('--check', EDITED);
    expect(r.code).not.toBe(0);
    expect(r.out).toBe(`${EDITED}: ccrc-edited\n`);
  });

  it('exits non-zero on a FOREIGN file — one that carries no marker at all', () => {
    const r = check('--check', FOREIGN);
    expect(r.code).not.toBe(0);
    expect(r.out).toBe(`${FOREIGN}: foreign\n`);
  });

  it('exits non-zero on a file it cannot read — a missing one, and a directory', () => {
    for (const p of [MISSING, A_DIR]) {
      const r = check('--check', p);
      expect(r.code, `${p}: ${r.out}${r.err}`).not.toBe(0);
      expect(r.out).toMatch(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}: unreadable \\(`));
    }
  });

  it('a usage error is non-zero too: no file, an extra argument, an unknown flag', () => {
    for (const args of [['--check'], ['--check', STAMPED, STAMPED], ['--verify', STAMPED], []]) {
      const r = check(...args);
      expect(r.code, JSON.stringify(args)).toBe(2);
      expect(r.err).toContain('usage: node shared/mark.mjs --check <file>');
    }
  });

  it('importing the module never runs the command — including the `node -e … <mark.mjs> <file>` shape ccrc restamp uses', () => {
    // Under `-e`, `process.argv[1]` is this module's own path: a command line
    // keyed on argv[1] alone would fire inside every restamp.
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e',
      'import { readFileSync } from "node:fs"; import { pathToFileURL } from "node:url";\n'
      + 'const [markPath, filePath] = process.argv.slice(1);\n'
      + 'const { verifyMarker } = await import(pathToFileURL(markPath).href);\n'
      + 'console.log("imported " + verifyMarker(readFileSync(filePath, "utf8")));',
      MARK, EDITED], { encoding: 'utf8', cwd: dir });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('imported ccrc-edited\n');
    // And a plain import from a script that is not this module.
    const importer = fixture('importer.mjs', `import { verifyMarker } from ${JSON.stringify(pathToFileURL(MARK).href)};\n`
      + 'console.log(typeof verifyMarker);\n');
    const s = spawnSync(process.execPath, [importer, '--check', MISSING], { encoding: 'utf8', cwd: dir });
    expect(s.status, s.stderr).toBe(0);
    expect(s.stdout).toBe('function\n');
  });

  it('`--check` after this module\'s path is never skipped — even under `node -e`, the command runs and fails an edited file', () => {
    // The eval exclusion above must not become a way to make the gate pass in
    // silence: argv[1] is this module and argv[2] is `--check`, so it runs.
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e',
      'import { pathToFileURL } from "node:url"; await import(pathToFileURL(process.argv[1]).href);',
      MARK, '--check', EDITED], { encoding: 'utf8', cwd: dir });
    expect(r.status, r.stderr).toBe(1);
    expect(r.stdout).toBe(`${EDITED}: ccrc-edited\n`);
  });
});
