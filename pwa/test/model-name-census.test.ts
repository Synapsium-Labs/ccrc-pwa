// D-8406: no model display name in shipped PWA source. A model's name comes from the lane's own files (the registry
// says which model a class maps to, the catalogue what it is called; `lib/models.ts`, `GET /api/models/:lane`), so a
// name spelled in `pwa/src` is a second, stale owner of that fact: the session model picker's four hard-coded labels
// went on naming models the gpt lane no longer ran. This census reads every non-test `.ts`/`.tsx`/`.css` file under
// `pwa/src`, comments included (a comment that names a model goes stale the same way), and fails on a family name
// followed by a version number. Tests are exempt: their fixtures and live model strings are data.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
/** A model display name: a family word, then a version (`GPT-6`, `GPT-6.1-Sol`, `Opus 5.5`, `Haiku 4.5`). */
const MODEL_NAME = /\b(GPT-\d|Opus \d|Sonnet \d|Haiku \d|Fable \d)/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Every `file:line` under `pwa/src` (tests aside) whose text names a model. */
function modelNames(files: readonly string[] = sources(SRC)): string[] {
  return files.flatMap((f) => readFileSync(f, 'utf8').split('\n').flatMap((line, i) =>
    MODEL_NAME.test(line) ? [`${path.relative(SRC, f)}:${i + 1}: ${line.trim()}`] : []));
}

describe('no model display name in pwa/src (D-8406)', () => {
  it('the census reads the shipped source, and the models module is in it', () => {
    const files = sources(SRC);
    expect(files.length, 'CONTROL: the walk found the source tree').toBeGreaterThan(100);
    expect(files.map((f) => path.relative(SRC, f))).toContain(path.join('lib', 'models.ts'));
    expect(files.some((f) => /\.test\.tsx?$/.test(f)), 'tests are not shipped source').toBe(false);
  });

  it('the pattern names each spelling the picker used to hard-code, and leaves class words alone', () => {
    for (const name of ['GPT-6 Astra', 'GPT-5.6 Sol', 'GPT-6.1-Sol', 'Opus 5.5', 'Sonnet 5', 'Fable 5', 'Haiku 4.5']) {
      expect(MODEL_NAME.test(name), name).toBe(true);
    }
    for (const word of ['Opus class', 'Fable class', 'opus', 'Default', 'gpt', 'classWord(cls)']) {
      expect(MODEL_NAME.test(word), word).toBe(false);
    }
  });

  it('no shipped file names a model', () => {
    expect(modelNames()).toEqual([]);
  });
});
