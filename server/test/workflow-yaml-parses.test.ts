// ── every workflow and composite action PARSES, as YAML (D-5565) ───────────
//
// #645 put `release.yml: could not` inside a PLAIN `run:` scalar. YAML reads
// `: ` there as a mapping indicator, so the file stopped parsing — and GitHub
// answers an unparseable workflow with a jobless failed run on every push and
// builds nothing on the tag that file exists for. Every other test of the
// workflows (build-release, release-main, oss-metadata) pins them as TEXT, and
// a text pin is blind to this: the bytes it looks for were all still there.
//
// So this one PARSES them, with a real YAML 1.2 parser (the `yaml` package, a
// devDependency with no dependencies of its own — no YAML parser ships with
// Node, and a system python or ruby is not a contract on either CI runner, so
// a guard that leaned on one would have to skip where it is missing, and a
// skip is a silent green). The file list is read from the tree, never a hand
// list, so a workflow added later is held to it without anyone remembering.
//
// The second check is the SILENT sibling of the same class: a ` #` inside a
// plain one-line `run:` starts a YAML comment, so the shell gets a truncated
// command and the file still parses. YAML does not know shell quoting —
// `run: echo "a #b"` hands the shell `echo "a`.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, visit, isMap, isScalar, Scalar } from 'yaml';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every workflow under .github/workflows and every composite action under
 *  .github/actions/<name>/, repo-relative — read from the tree. */
function workflowFiles(): string[] {
  const out: string[] = [];
  const wf = join(REPO, '.github', 'workflows');
  for (const f of readdirSync(wf)) if (/\.ya?ml$/.test(f)) out.push(`.github/workflows/${f}`);
  const actions = join(REPO, '.github', 'actions');
  if (existsSync(actions)) {
    for (const d of readdirSync(actions, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of ['action.yml', 'action.yaml']) {
        if (existsSync(join(actions, d.name, f))) out.push(`.github/actions/${d.name}/${f}`);
      }
    }
  }
  return out.sort();
}

/** The parse errors of one YAML source, one line each — empty when it parses. */
function parseErrors(src: string): string[] {
  const doc = parseDocument(src, { uniqueKeys: true });
  return doc.errors.map((e) => `${e.code}: ${e.message.split('\n')[0]}`);
}

/** Every one-line PLAIN `run:` value that a ` #` comment cut short: the text
 *  the parser kept, and the comment it dropped. */
function truncatedRuns(src: string): string[] {
  const doc = parseDocument(src, { uniqueKeys: true });
  const out: string[] = [];
  visit(doc, {
    Pair(_key, pair) {
      if (!isScalar(pair.key) || pair.key.value !== 'run') return;
      const v = pair.value;
      if (!isScalar(v) || v.type !== Scalar.PLAIN || v.range === undefined || v.range === null) return;
      const end = src.indexOf('\n', v.range[1]);
      const rest = src.slice(v.range[1], end === -1 ? undefined : end);
      if (rest.includes('#')) out.push(`run: ${String(v.value)} ⟨dropped:${rest}⟩`);
    },
  });
  return out;
}

describe('every workflow and composite action parses as YAML (D-5565)', () => {
  const files = workflowFiles();

  it('finds the workflows to hold (the guard is not vacuous)', () => {
    for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml',
      '.github/workflows/release-main.yml', '.github/workflows/release-stable.yml',
      '.github/actions/server-deps/action.yml']) {
      expect(files, `${f} is not in the scan`).toContain(f);
    }
  });

  it.each(files)('%s parses, to a mapping', (rel) => {
    const src = readFileSync(join(REPO, rel), 'utf8');
    expect(parseErrors(src), `${rel} does not parse — GitHub runs nothing from it`).toEqual([]);
    const doc = parseDocument(src, { uniqueKeys: true });
    expect(isMap(doc.contents), `${rel}: the document is not a mapping`).toBe(true);
    const top = doc.toJS() as Record<string, unknown>;
    if (rel.startsWith('.github/workflows/')) {
      expect(top, `${rel}: no jobs:`).toHaveProperty('jobs');
    } else {
      expect(top, `${rel}: no runs:`).toHaveProperty('runs');
    }
  });

  it.each(files)('%s: no one-line run: is cut short by a # comment', (rel) => {
    expect(truncatedRuns(readFileSync(join(REPO, rel), 'utf8'))).toEqual([]);
  });

  // The mutation rows, kept as cases so the guard's teeth are re-proved on
  // every run rather than measured once and remembered.
  const STEP = (run: string): string =>
    `name: x\non:\n  push:\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - name: y\n${run}\n`;

  it('reds on the #645 form of the release-notes step (a ": " inside a plain run:)', () => {
    const broken = STEP('        run: node deploy/release-notes.mjs --out "$RUNNER_TEMP/n.txt" || { echo "::warning::release.yml: could not write the release notes"; : > "$RUNNER_TEMP/n.txt"; }');
    expect(parseErrors(broken).length).toBeGreaterThan(0);
  });

  it('reds on a tab-indented line', () => {
    const broken = STEP('        run: |\n\t  echo ok');
    expect(parseErrors(broken).length).toBeGreaterThan(0);
  });

  it('is green on the block-scalar form of the same step', () => {
    const fixed = STEP('        run: |\n          node deploy/release-notes.mjs --out "$RUNNER_TEMP/n.txt" || { echo "::warning::release.yml: could not write the release notes"; : > "$RUNNER_TEMP/n.txt"; }');
    expect(parseErrors(fixed)).toEqual([]);
    expect(truncatedRuns(fixed)).toEqual([]);
  });

  it('sees a plain run: that a # comment cut short, and not a block one', () => {
    expect(truncatedRuns(STEP('        run: echo "a #b"'))).toHaveLength(1);
    expect(truncatedRuns(STEP('        run: |\n          echo "a #b"'))).toEqual([]);
  });
});
