// The `on:` block of a workflow, read as an exact text block, and the
// paths-ignore patterns inside it. One reader for both release-main rows that
// depend on the trigger: W25-F1 (build-release.test.ts) pins the block, and
// W25-T8 (release-stable.test.ts) ties release-stable.sh's arms to its
// patterns (D-6512, D-6513).
import { expect } from 'vitest';

/** From the line `on:` up to the next top-level key, comments and blank lines
 *  stripped. Never a regex that ends at `$`, which a longer line or a
 *  following key would satisfy (D-6513). */
export const onBlock = (src: string): string[] => {
  const lines = src.split('\n');
  const from = lines.indexOf('on:');
  expect(from, 'the workflow has a top-level on: line').toBeGreaterThan(-1);
  const out = ['on:'];
  for (const l of lines.slice(from + 1)) {
    if (/^[A-Za-z_]/.test(l)) break;
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    out.push(l);
  }
  return out;
};

/** The push trigger's paths-ignore patterns, from its one flow-list line.
 *  Anything but single-quoted entries in one `[...]` throws, so a respelled
 *  list is a red row, never an empty one. */
export const pathsIgnore = (src: string): string[] => {
  const lines = onBlock(src).filter((l) => /^\s+paths-ignore:/.test(l));
  expect(lines, 'the on: block has one paths-ignore line').toHaveLength(1);
  const m = /^ {4}paths-ignore: \[(.*)\]$/.exec(lines[0]);
  if (m === null) throw new Error(`paths-ignore is not a one-line flow list under push: ${lines[0]}`);
  return m[1].split(/,\s*/).map((item) => {
    const q = /^'([^']+)'$/.exec(item);
    if (q === null) throw new Error(`paths-ignore entry is not a single-quoted pattern: ${item}`);
    return q[1];
  });
};
