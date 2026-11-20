// The test box's programs are installed behind a link (`<tools>/release/installed`), and the service unit starts the
// service through it. node resolves a module's own URL through the link and leaves argv[1] as typed, so the "started as the
// program" check compares real paths: by the paths as written the service read itself as imported, did nothing and
// exited 0, and the unit restarted it every five seconds.
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startedAsProgram } from '../src/testbox/entry.js';
import { mkTmp } from './tmpHelpers.js';

function tree(): { real: string; viaLink: string; other: string } {
  const dir = mkTmp('ccrc-tb-entry-');
  mkdirSync(path.join(dir, 'release', 'v1'), { recursive: true });
  const real = path.join(dir, 'release', 'v1', 'main.js');
  writeFileSync(real, '');
  writeFileSync(path.join(dir, 'release', 'v1', 'other.js'), '');
  symlinkSync('v1', path.join(dir, 'release', 'installed'));
  return { real, viaLink: path.join(dir, 'release', 'installed', 'main.js'), other: path.join(dir, 'release', 'installed', 'other.js') };
}

describe('the test box programs know they were started as the program', () => {
  it('through the installed link, as the service unit starts it', () => {
    const t = tree();
    expect(startedAsProgram(t.viaLink, pathToFileURL(t.real).href)).toBe(true);
    expect(startedAsProgram(t.real, pathToFileURL(t.real).href)).toBe(true);
  });
  it('and not when another file was the program, when there was none, or when the path does not exist', () => {
    const t = tree();
    expect(startedAsProgram(t.other, pathToFileURL(t.real).href)).toBe(false);
    expect(startedAsProgram(undefined, pathToFileURL(t.real).href)).toBe(false);
    expect(startedAsProgram(path.join(path.dirname(t.real), 'gone.js'), pathToFileURL(t.real).href)).toBe(false);
  });
  it('the service and the client both ask it, and neither compares the paths as written', () => {
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'testbox');
    for (const f of ['main.ts', 'client.ts']) {
      const text = readFileSync(path.join(src, f), 'utf8');
      expect(text, f).toContain('const invoked = startedAsProgram(process.argv[1], import.meta.url);');
      expect(text, f).not.toContain('path.resolve(process.argv[1])');
    }
  });
});
